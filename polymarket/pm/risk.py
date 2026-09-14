"""Capital floor and exposure limits — the part of the system that says NO.

"The account cannot lose money" is not something any trading system can promise: every
position can go to zero. What we *can* enforce is a hard bound on the worst case:

  floor  = initial * (1 - initial_max_drawdown) + max(0, hwm - initial) * (1 - trailing_drawdown)
  budget = equity - floor - open_exposure

i.e. we accept losing at most `initial_max_drawdown` of the starting stake, and of every dollar
of profit at a new high-water mark, `1 - trailing_drawdown` is locked away for good.

No new position may be opened whose full cost exceeds `budget`. Because every Polymarket
share can at worst go to $0, total cost of open positions == worst-case loss, so equity
can never fall below the floor through trading losses. The floor only ever ratchets up.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .config import Config
from .state import State


@dataclass
class RiskSnapshot:
    equity: float
    floor: float
    exposure: float
    budget: float           # max cost of *new* positions right now
    halted: bool
    reason: str = ""


def floor_usd(cfg: Config, st: State) -> float:
    init_dd = float(cfg.get("risk.initial_max_drawdown", 0.20))
    trail_dd = float(cfg.get("risk.trailing_drawdown", 0.10))
    f_init = st.initial_bankroll_usd * (1 - init_dd)
    locked = max(0.0, st.hwm_usd - st.initial_bankroll_usd) * (1 - trail_dd)
    return f_init + locked


def snapshot(cfg: Config, st: State, marks: dict[str, float] | None = None,
             now: datetime | None = None) -> RiskSnapshot:
    now = now or datetime.now(timezone.utc)
    equity = st.equity_usd(marks)
    fl = floor_usd(cfg, st)
    exp = st.exposure_usd()
    budget = max(0.0, equity - fl - exp)
    # hard cap on total exposure as a fraction of equity
    max_total = float(cfg.get("risk.max_total_exposure_frac", 0.6)) * equity
    budget = min(budget, max(0.0, max_total - exp))
    # daily loss halt
    halted, reason = False, ""
    if st.halted_until:
        try:
            if datetime.fromisoformat(st.halted_until) > now:
                halted, reason = True, f"halted until {st.halted_until}"
        except ValueError:
            pass
    day = st.daily or {}
    if day.get("date") == now.date().isoformat() and day.get("start_equity"):
        dd = 1 - equity / float(day["start_equity"])
        if dd >= float(cfg.get("risk.daily_loss_halt", 0.05)):
            halted, reason = True, f"daily loss {dd:.1%} >= halt threshold"
    if halted:
        budget = 0.0
    return RiskSnapshot(equity=equity, floor=fl, exposure=exp, budget=budget, halted=halted, reason=reason)


def roll_day(st: State, equity: float, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    today = now.date().isoformat()
    if (st.daily or {}).get("date") != today:
        st.daily = {"date": today, "start_equity": equity}


def halt(st: State, hours: float, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    st.halted_until = (now + timedelta(hours=hours)).isoformat()


def position_caps(cfg: Config, st: State, equity: float, event_id: str | None, market_id: str) -> float:
    """Max additional cost allowed for this market given per-market / per-event caps."""
    per_mkt = float(cfg.get("risk.max_position_frac", 0.15)) * equity
    per_evt = float(cfg.get("risk.max_event_frac", 0.25)) * equity
    in_mkt = sum(p.cost_usd for p in st.open_positions() if p.market_id == market_id)
    in_evt = sum(p.cost_usd for p in st.open_positions() if event_id and p.event_id == event_id)
    cap = per_mkt - in_mkt
    if event_id:
        cap = min(cap, per_evt - in_evt)
    return max(0.0, cap)


def market_filters(cfg: Config, m, book_yes, hours_left: float | None) -> list[str]:
    """Return list of reasons a market is untradeable (empty = ok)."""
    why: list[str] = []
    if m.liquidity < float(cfg.get("filters.min_liquidity_usd", 5000)):
        why.append("thin-liquidity")
    if m.volume_24h < float(cfg.get("filters.min_volume24h_usd", 500)):
        why.append("low-volume")
    sp = book_yes.spread
    if sp is None:
        why.append("no-book")
    elif sp > float(cfg.get("filters.max_spread", 0.04)):
        why.append("wide-spread")
    mid = book_yes.mid if book_yes.mid is not None else m.yes_price
    if not (float(cfg.get("filters.min_price", 0.04)) <= mid <= float(cfg.get("filters.max_price", 0.96))):
        why.append("extreme-price")
    if hours_left is None:
        why.append("no-end-date")
    else:
        if hours_left < float(cfg.get("filters.min_hours_to_resolution", 6)):
            why.append("resolves-too-soon")
        if hours_left > float(cfg.get("filters.max_days_to_resolution", 45)) * 24:
            why.append("resolves-too-late")
    return why
