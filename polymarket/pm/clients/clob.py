"""Polymarket CLOB public read endpoints (order book, mid, history). Free, no auth."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..http import get_json, qs

CLOB = "https://clob.polymarket.com"


@dataclass
class Level:
    price: float
    size: float


@dataclass
class Book:
    token_id: str
    bids: list[Level] = field(default_factory=list)  # sorted best (highest) first
    asks: list[Level] = field(default_factory=list)  # sorted best (lowest) first

    @property
    def best_bid(self) -> float | None:
        return self.bids[0].price if self.bids else None

    @property
    def best_ask(self) -> float | None:
        return self.asks[0].price if self.asks else None

    @property
    def mid(self) -> float | None:
        if self.best_bid is None or self.best_ask is None:
            return None
        return (self.best_bid + self.best_ask) / 2

    @property
    def spread(self) -> float | None:
        if self.best_bid is None or self.best_ask is None:
            return None
        return self.best_ask - self.best_bid

    def depth_within(self, side: str, ticks: float) -> float:
        """USD notional available within `ticks` of the top of book on one side."""
        levels = self.asks if side == "ask" else self.bids
        if not levels:
            return 0.0
        top = levels[0].price
        tot = 0.0
        for lv in levels:
            if abs(lv.price - top) <= ticks + 1e-9:
                tot += lv.price * lv.size
        return tot

    def fill_cost(self, usd: float) -> tuple[float, float]:
        """Walk the asks to spend `usd`. Returns (shares, avg_price). Partial if book too thin."""
        remaining = usd
        shares = 0.0
        for lv in self.asks:
            cost_here = lv.price * lv.size
            take = min(cost_here, remaining)
            shares += take / lv.price
            remaining -= take
            if remaining <= 1e-9:
                break
        spent = usd - max(remaining, 0.0)
        return shares, (spent / shares if shares > 0 else 0.0)

    def sell_proceeds(self, shares: float) -> tuple[float, float]:
        """Walk the bids to sell `shares`. Returns (proceeds, avg_price)."""
        remaining = shares
        proceeds = 0.0
        for lv in self.bids:
            take = min(lv.size, remaining)
            proceeds += take * lv.price
            remaining -= take
            if remaining <= 1e-9:
                break
        sold = shares - max(remaining, 0.0)
        return proceeds, (proceeds / sold if sold > 0 else 0.0)


def get_book(token_id: str, ttl: float = 0) -> Book:
    d = get_json(f"{CLOB}/book?" + qs({"token_id": token_id}), ttl=ttl)
    bids = sorted((Level(float(x["price"]), float(x["size"])) for x in d.get("bids", [])),
                  key=lambda l: -l.price)
    asks = sorted((Level(float(x["price"]), float(x["size"])) for x in d.get("asks", [])),
                  key=lambda l: l.price)
    return Book(token_id=token_id, bids=bids, asks=asks)


def get_history(token_id: str, interval: str = "1w", fidelity: int = 60, ttl: float = 600) -> list[tuple[int, float]]:
    d = get_json(f"{CLOB}/prices-history?" + qs({"market": token_id, "interval": interval,
                                                   "fidelity": fidelity}), ttl=ttl)
    return [(int(h["t"]), float(h["p"])) for h in d.get("history", [])]
