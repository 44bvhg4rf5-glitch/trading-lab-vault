"""Kelly sizing for binary contracts (a share pays 1 unit if the outcome happens, else 0).

Two fee models are supported:
  * TakerFee      — Polymarket style, charged on entry: rate * p * (1 - p) per share.
  * Commission    — exchange style (Smarkets, Betfair), charged on net winnings only.

Both reduce to "net odds b per unit staked". Kelly: f* = p - (1 - p) / b.
The breakeven probability is 1 / (1 + b); edge = p - breakeven. We trade only when
edge >= min_edge and then bet a fraction of Kelly.
"""
from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
class FeeModel:
    name = "none"

    def entry_fee(self, price: float, shares: float) -> float:
        """Fee paid when buying `shares` at `price` (added to cost)."""
        return 0.0

    def settle(self, proceeds: float, cost: float) -> float:
        """Net proceeds after any fee charged on exit/settlement."""
        return proceeds

    def net_odds(self, price: float) -> float:
        """Net profit per unit of cost if the bought side pays out."""
        if price <= 0 or price >= 1:
            return 0.0
        return (1.0 - price) / price

    def breakeven(self, price: float) -> float:
        b = self.net_odds(price)
        return 1.0 if b <= 0 else 1.0 / (1.0 + b)


class TakerFee(FeeModel):
    name = "taker"

    def __init__(self, rate: float):
        self.rate = rate

    def per_share(self, price: float) -> float:
        return self.rate * price * (1.0 - price)

    def entry_fee(self, price: float, shares: float) -> float:
        return self.per_share(price) * shares

    def settle(self, proceeds: float, cost: float) -> float:
        return proceeds  # already charged on the way in (and on the sell leg by the executor)

    def net_odds(self, price: float) -> float:
        c = price + self.per_share(price)
        if c <= 0 or c >= 1:
            return 0.0
        return (1.0 - c) / c


class Commission(FeeModel):
    name = "commission"

    def __init__(self, rate: float):
        self.rate = rate

    def settle(self, proceeds: float, cost: float) -> float:
        profit = proceeds - cost
        return proceeds - self.rate * profit if profit > 0 else proceeds

    def net_odds(self, price: float) -> float:
        if price <= 0 or price >= 1:
            return 0.0
        return (1.0 - price) / price * (1.0 - self.rate)


def taker_fee_per_share(price: float, rate: float) -> float:
    return TakerFee(rate).per_share(price)


# ---------------------------------------------------------------------------
@dataclass
class KellyDecision:
    side: str            # "YES" or "NO"
    prob: float          # our probability the bought side pays out
    price: float         # quoted price of the bought side
    cost: float          # breakeven probability (price incl. the fee model)
    edge: float          # prob - breakeven
    kelly_full: float    # optimal fraction of bankroll
    kelly_frac: float    # fraction after scaling
    stake_usd: float     # venue-currency amount to commit
    shares: float

    def as_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def kelly_fraction(p: float, net_odds: float) -> float:
    if net_odds <= 0:
        return 0.0
    return max(0.0, p - (1.0 - p) / net_odds)


def size_side(side: str, p_side: float, price: float, *, bankroll: float, fee: FeeModel,
              fraction: float, min_edge: float, max_stake: float) -> KellyDecision | None:
    b = fee.net_odds(price)
    if b <= 0:
        return None
    breakeven = 1.0 / (1.0 + b)
    edge = p_side - breakeven
    if edge < min_edge - 1e-9:
        return None
    f_full = kelly_fraction(p_side, b)
    f = f_full * fraction
    stake = min(f * bankroll, max_stake)
    if stake <= 0:
        return None
    return KellyDecision(side=side, prob=p_side, price=price, cost=breakeven, edge=edge,
                         kelly_full=f_full, kelly_frac=f, stake_usd=stake, shares=stake / price)


def decide(p_yes: float, yes_ask: float | None, no_ask: float | None, *, bankroll: float,
           fee: FeeModel, fraction: float, min_edge: float, max_stake: float) -> KellyDecision | None:
    """Evaluate buying YES and buying NO; return the better positive-edge option, if any."""
    best: KellyDecision | None = None
    if yes_ask is not None and 0 < yes_ask < 1:
        best = size_side("YES", p_yes, yes_ask, bankroll=bankroll, fee=fee, fraction=fraction,
                         min_edge=min_edge, max_stake=max_stake)
    if no_ask is not None and 0 < no_ask < 1:
        d = size_side("NO", 1.0 - p_yes, no_ask, bankroll=bankroll, fee=fee, fraction=fraction,
                      min_edge=min_edge, max_stake=max_stake)
        if d and (best is None or d.edge > best.edge):
            best = d
    return best


def expected_log_growth(p: float, cost: float, f: float) -> float:
    """Per-bet expected log growth when betting fraction f at breakeven `cost` with win prob p."""
    import math
    if f <= 0:
        return 0.0
    b = (1 - cost) / cost
    return p * math.log(1 + f * b) + (1 - p) * math.log(1 - f)
