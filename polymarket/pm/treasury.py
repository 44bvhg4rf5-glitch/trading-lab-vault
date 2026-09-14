"""40/40/20 profit split.

Whenever total equity makes a *new high* above the last distributed level, the fresh profit
is split: 40% stays in the trading bankroll (compounding), 40% goes to a 'tools' reserve
(paying for upgrades, data, compute), 20% to an 'owner' reserve. Reserves are moved out of
tradeable cash so the bot can never risk them — this is what makes the account ratchet.
Small dust is not split until it reaches `split_min_profit_usd`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .config import Config
from .state import State


@dataclass
class Distribution:
    profit: float
    reinvest: float
    tools: float
    owner: float
    at: str

    def as_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def distributable_profit(st: State, equity: float) -> float:
    """Profit above initial bankroll that has not yet been split, counting only *realised*
    cash (we never distribute unrealised marks)."""
    realised_equity = st.cash_usd + st.exposure_usd()  # positions at cost
    gross = realised_equity + st.total_banked_usd() - st.initial_bankroll_usd
    return max(0.0, gross - st.distributed_profit_usd)


def maybe_distribute(cfg: Config, st: State, equity: float, now: datetime | None = None) -> Distribution | None:
    now = now or datetime.now(timezone.utc)
    profit = distributable_profit(st, equity)
    if profit < float(cfg.get("split_min_profit_usd", 5.0)):
        return None
    # only bank cash we actually hold (never dip into positions)
    split = cfg.split
    tools = profit * split["tools"]
    owner = profit * split["owner"]
    take = tools + owner
    if take > st.cash_usd:
        return None
    st.cash_usd -= take
    st.reserves["tools"] = st.reserves.get("tools", 0.0) + tools
    st.reserves["owner"] = st.reserves.get("owner", 0.0) + owner
    st.distributed_profit_usd += profit
    return Distribution(profit=profit, reinvest=profit * split["reinvest"], tools=tools, owner=owner,
                        at=now.isoformat())
