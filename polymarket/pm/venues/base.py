from __future__ import annotations

from ..clients.clob import Book
from ..clients.gamma import Market
from ..kelly import FeeModel


class Venue:
    name = "base"
    currency = "USD"

    def __init__(self, cfg):
        self.cfg = cfg

    # --- market data ---------------------------------------------------------
    def scan_markets(self, max_events: int) -> list[Market]:  # pragma: no cover - interface
        raise NotImplementedError

    def get_market(self, market_id: str) -> Market | None:  # pragma: no cover
        raise NotImplementedError

    def get_book(self, token_id: str) -> Book:  # pragma: no cover
        raise NotImplementedError

    def get_history(self, token_id: str) -> list[tuple[int, float]]:
        return []

    def siblings(self, market: Market, universe: list[Market]) -> list[Market]:
        if not market.event_id:
            return []
        return [m for m in universe if m.event_id == market.event_id and m.id != market.id]

    def prefetch(self, markets: list[Market]) -> None:
        """Optional: warm caches for a batch of markets (venues with multi-id endpoints)."""

    # --- economics -----------------------------------------------------------
    def fee_model(self) -> FeeModel:  # pragma: no cover
        raise NotImplementedError

    def units_per_gbp(self) -> float:
        """How many venue currency units one pound buys (1.0 for a GBP venue)."""
        return 1.0

    # --- execution -----------------------------------------------------------
    def build_executor(self, mode: str):  # pragma: no cover
        raise NotImplementedError
