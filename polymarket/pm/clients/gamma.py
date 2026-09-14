"""Polymarket Gamma API — market and event discovery. Public, no auth, free."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..http import get_json, qs

GAMMA = "https://gamma-api.polymarket.com"


@dataclass
class Market:
    id: str
    condition_id: str
    question: str
    slug: str
    description: str
    outcomes: list[str]
    outcome_prices: list[float]
    token_ids: list[str]
    end_date: datetime | None
    liquidity: float
    volume_24h: float
    neg_risk: bool
    active: bool
    closed: bool
    accepting_orders: bool
    min_order_size: float
    tick: float
    event_id: str | None = None
    event_title: str | None = None
    group_item_title: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    # convenience --------------------------------------------------------
    @property
    def yes_token(self) -> str:
        return self.token_ids[0]

    @property
    def no_token(self) -> str:
        return self.token_ids[1]

    @property
    def yes_price(self) -> float:
        return self.outcome_prices[0]

    def hours_to_resolution(self, now: datetime | None = None) -> float | None:
        if not self.end_date:
            return None
        now = now or datetime.now(timezone.utc)
        return (self.end_date - now).total_seconds() / 3600.0

    def resolved_outcome(self) -> int | None:
        """0 = YES won, 1 = NO won, None = not resolved (from Gamma prices)."""
        if not self.closed or len(self.outcome_prices) != 2:
            return None
        a, b = self.outcome_prices
        if a >= 0.999 and b <= 0.001:
            return 0
        if b >= 0.999 and a <= 0.001:
            return 1
        return None


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _json_list(v: Any) -> list:
    if v is None:
        return []
    if isinstance(v, list):
        return v
    try:
        return json.loads(v)
    except Exception:
        return []


def parse_market(m: dict[str, Any], event: dict[str, Any] | None = None) -> Market | None:
    outcomes = _json_list(m.get("outcomes"))
    prices = [float(x) for x in _json_list(m.get("outcomePrices"))]
    tokens = [str(t) for t in _json_list(m.get("clobTokenIds"))]
    if len(outcomes) != 2 or len(prices) != 2 or len(tokens) != 2:
        return None  # only binary YES/NO markets
    return Market(
        id=str(m.get("id")),
        condition_id=str(m.get("conditionId", "")),
        question=m.get("question", ""),
        slug=m.get("slug", ""),
        description=m.get("description", "") or "",
        outcomes=outcomes,
        outcome_prices=prices,
        token_ids=tokens,
        end_date=_parse_dt(m.get("endDate")),
        liquidity=float(m.get("liquidityNum") or m.get("liquidity") or 0),
        volume_24h=float(m.get("volume24hr") or 0),
        neg_risk=bool(m.get("negRisk", False)),
        active=bool(m.get("active", False)),
        closed=bool(m.get("closed", False)),
        accepting_orders=bool(m.get("acceptingOrders", False)),
        min_order_size=float(m.get("orderMinSize") or 5),
        tick=float(m.get("orderPriceMinTickSize") or 0.01),
        event_id=str(event.get("id")) if event else None,
        event_title=event.get("title") if event else None,
        group_item_title=m.get("groupItemTitle"),
        raw=m,
    )


def list_events(limit: int = 100, order: str = "volume24hr", offset: int = 0, ttl: float = 120) -> list[dict]:
    url = f"{GAMMA}/events?" + qs({"active": "true", "closed": "false", "limit": limit,
                                   "offset": offset, "order": order, "ascending": "false"})
    return get_json(url, ttl=ttl)


def scan_markets(max_events: int = 200, ttl: float = 120) -> list[Market]:
    """Return active binary markets, grouped with their parent event (for negRisk consistency)."""
    out: list[Market] = []
    page = 100
    for offset in range(0, max_events, page):
        events = list_events(limit=min(page, max_events - offset), offset=offset, ttl=ttl)
        if not events:
            break
        for ev in events:
            for m in ev.get("markets", []) or []:
                mk = parse_market(m, ev)
                if mk and mk.active and not mk.closed and mk.accepting_orders:
                    out.append(mk)
    return out


def get_market(market_id: str, ttl: float = 0) -> Market | None:
    m = get_json(f"{GAMMA}/markets/{market_id}", ttl=ttl)
    return parse_market(m)


def siblings(market: Market, universe: list[Market]) -> list[Market]:
    """Other markets in the same negRisk event (mutually exclusive outcomes)."""
    if not market.event_id:
        return []
    return [m for m in universe if m.event_id == market.event_id and m.id != market.id]
