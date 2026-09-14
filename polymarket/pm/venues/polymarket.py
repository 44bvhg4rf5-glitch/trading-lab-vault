from __future__ import annotations

from ..clients import clob, gamma
from ..clients.fx import gbp_usd
from ..execution import LiveExecutor, PaperExecutor
from ..kelly import TakerFee
from .base import Venue


class PolymarketVenue(Venue):
    name = "polymarket"
    currency = "USD"

    def scan_markets(self, max_events: int):
        return gamma.scan_markets(max_events=max_events)

    def get_market(self, market_id: str):
        return gamma.get_market(market_id)

    def get_book(self, token_id: str):
        return clob.get_book(token_id)

    def get_history(self, token_id: str):
        return clob.get_history(token_id)

    def fee_model(self):
        return TakerFee(float(self.cfg.get("fees.taker_rate", 0.07)))

    def units_per_gbp(self) -> float:
        return gbp_usd(float(self.cfg.get("fx_fallback_gbp_usd", 1.30)))

    def build_executor(self, mode: str):
        fee = self.fee_model()
        if mode == "live":
            return LiveExecutor(fee, bool(self.cfg.get("fees.prefer_maker", True)))
        return PaperExecutor(fee)
