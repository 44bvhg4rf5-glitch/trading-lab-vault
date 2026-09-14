"""Kelly sizing for binary contracts (shares pay $1 if the outcome happens, else $0).

Buying a share at cost c with true probability p:
    net odds b = (1 - c) / c
    f* = (p*b - (1-p)) / b = (p - c) / (1 - c)
We use the *effective* cost (price + fee) and only trade when p - c_eff >= min_edge.
Then we take a fraction of Kelly (default 1/4) — the growth-optimal bet is far too volatile
for a small account that must not draw down.
"""
from __future__ import annotations

from dataclasses import dataclass


def taker_fee_per_share(price: float, rate: float) -> float:
    """Polymarket-style fee: rate * p * (1 - p) per share, charged to takers only."""
    return rate * price * (1.0 - price)


def effective_cost(price: float, fee_rate: float, maker: bool) -> float:
    return price if maker else price + taker_fee_per_share(price, fee_rate)


@dataclass
class KellyDecision:
    side: str            # "YES" or "NO"
    prob: float          # our probability the bought side pays out
    price: float         # quoted price of the bought side
    cost: float          # effective cost incl. fees
    edge: float          # prob - cost
    kelly_full: float    # optimal fraction of bankroll
    kelly_frac: float    # fraction after scaling
    stake_usd: float     # dollars to commit
    shares: float

    def as_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def kelly_fraction(p: float, cost: float) -> float:
    if cost <= 0 or cost >= 1:
        return 0.0
    return max(0.0, (p - cost) / (1.0 - cost))


def size_side(side: str, p_side: float, price: float, *, bankroll: float, fee_rate: float,
              maker: bool, fraction: float, min_edge: float, max_stake: float) -> KellyDecision | None:
    cost = effective_cost(price, fee_rate, maker)
    edge = p_side - cost
    if edge < min_edge - 1e-9:
        return None
    f_full = kelly_fraction(p_side, cost)
    f = f_full * fraction
    stake = min(f * bankroll, max_stake)
    if stake <= 0:
        return None
    return KellyDecision(side=side, prob=p_side, price=price, cost=cost, edge=edge,
                         kelly_full=f_full, kelly_frac=f, stake_usd=stake, shares=stake / price)


def decide(p_yes: float, yes_ask: float | None, no_ask: float | None, *, bankroll: float,
           fee_rate: float, maker: bool, fraction: float, min_edge: float,
           max_stake: float) -> KellyDecision | None:
    """Evaluate buying YES and buying NO; return the better positive-edge option, if any."""
    best: KellyDecision | None = None
    if yes_ask is not None and 0 < yes_ask < 1:
        d = size_side("YES", p_yes, yes_ask, bankroll=bankroll, fee_rate=fee_rate, maker=maker,
                      fraction=fraction, min_edge=min_edge, max_stake=max_stake)
        if d:
            best = d
    if no_ask is not None and 0 < no_ask < 1:
        d = size_side("NO", 1.0 - p_yes, no_ask, bankroll=bankroll, fee_rate=fee_rate, maker=maker,
                      fraction=fraction, min_edge=min_edge, max_stake=max_stake)
        if d and (best is None or d.edge > best.edge):
            best = d
    return best


def expected_log_growth(p: float, cost: float, f: float) -> float:
    """Per-bet expected log growth of bankroll when betting fraction f at cost c with win prob p."""
    import math
    if f <= 0:
        return 0.0
    b = (1 - cost) / cost
    return p * math.log(1 + f * b) + (1 - p) * math.log(1 - f)
