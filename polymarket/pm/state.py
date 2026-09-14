"""Persistent account state: bankroll, positions, high-water mark, reserves. Plain JSON."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import STATE_DIR


@dataclass
class Position:
    id: str
    market_id: str
    condition_id: str
    question: str
    side: str            # YES / NO
    token_id: str
    shares: float
    avg_price: float     # per share incl. fees
    cost_usd: float
    opened_at: str
    p_est: float
    edge: float
    event_id: str | None = None
    order_id: str | None = None
    status: str = "open"          # open | closed
    exit_price: float | None = None
    pnl_usd: float | None = None
    closed_at: str | None = None
    close_reason: str | None = None

    @property
    def worst_case_loss(self) -> float:
        return self.cost_usd


@dataclass
class State:
    created_at: str
    initial_bankroll_usd: float
    cash_usd: float                          # tradeable cash (reserves already excluded)
    hwm_usd: float                           # high-water mark of total equity
    reserves: dict[str, float] = field(default_factory=lambda: {"tools": 0.0, "owner": 0.0})
    distributed_profit_usd: float = 0.0      # profit that has already been split
    positions: list[Position] = field(default_factory=list)
    halted_until: str | None = None
    daily: dict[str, Any] = field(default_factory=dict)   # {"date":..., "start_equity":...}
    gbp_usd: float = 1.30
    last_scan: str | None = None
    stats: dict[str, Any] = field(default_factory=dict)

    # --- derived -----------------------------------------------------------
    def open_positions(self) -> list[Position]:
        return [p for p in self.positions if p.status == "open"]

    def exposure_usd(self) -> float:
        return sum(p.cost_usd for p in self.open_positions())

    def equity_usd(self, marks: dict[str, float] | None = None) -> float:
        """Cash + open positions marked at `marks` (token_id -> bid) or at cost when unknown."""
        val = self.cash_usd
        for p in self.open_positions():
            mark = (marks or {}).get(p.token_id)
            val += p.shares * (mark if mark is not None else p.avg_price)
        return val

    def total_banked_usd(self) -> float:
        return sum(self.reserves.values())

    # --- io ----------------------------------------------------------------
    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "State":
        d = dict(d)
        d["positions"] = [Position(**p) for p in d.get("positions", [])]
        return cls(**d)


def state_path() -> Path:
    return STATE_DIR / "state.json"


def load_state() -> State | None:
    p = state_path()
    if not p.exists():
        return None
    return State.from_dict(json.loads(p.read_text(encoding="utf-8")))


def save_state(st: State) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = state_path().with_suffix(".tmp")
    tmp.write_text(json.dumps(st.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(state_path())


def new_state(bankroll_usd: float, gbp_usd: float) -> State:
    now = datetime.now(timezone.utc).isoformat()
    return State(created_at=now, initial_bankroll_usd=bankroll_usd, cash_usd=bankroll_usd,
                 hwm_usd=bankroll_usd, gbp_usd=gbp_usd)
