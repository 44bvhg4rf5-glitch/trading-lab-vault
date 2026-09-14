"""Executors. Paper mode simulates fills against the live order book (conservatively as a
taker). Live executors are opt-in only and venue-specific.

LIVE TRADING IS GATED: it requires mode=live in config, PM_LIVE_ACK=I_UNDERSTAND in the
environment, and the venue's credentials. Venues geoblock some countries; it is your
responsibility to only trade where you are allowed to. This code bypasses nothing.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from .clients.clob import Book
from .kelly import FeeModel


@dataclass
class Fill:
    order_id: str
    shares: float
    avg_price: float      # per share incl. any entry fee
    cost_usd: float       # buy: total cost; sell: net proceeds
    maker: bool


def require_live_ack() -> None:
    if os.environ.get("PM_LIVE_ACK") != "I_UNDERSTAND":
        raise RuntimeError("live mode requires PM_LIVE_ACK=I_UNDERSTAND in the environment")


class PaperExecutor:
    name = "paper"

    def __init__(self, fee: FeeModel):
        self.fee = fee

    def buy(self, token_id: str, book: Book, usd: float, tick: float) -> Fill | None:
        shares, avg = book.fill_cost(usd)
        if shares <= 0:
            return None
        cost = shares * avg + self.fee.entry_fee(avg, shares)
        return Fill(order_id="paper-" + uuid.uuid4().hex[:8], shares=shares,
                    avg_price=cost / shares, cost_usd=cost, maker=False)

    def sell(self, token_id: str, book: Book, shares: float, tick: float) -> Fill | None:
        proceeds, avg = book.sell_proceeds(shares)
        if proceeds <= 0:
            return None
        sold = proceeds / avg
        net = proceeds - self.fee.entry_fee(avg, sold)   # taker fee on the sell leg, 0 for commission venues
        return Fill(order_id="paper-" + uuid.uuid4().hex[:8], shares=sold,
                    avg_price=net / sold, cost_usd=net, maker=False)


class LiveExecutor:
    """Polymarket: thin wrapper over py-clob-client, imported lazily."""
    name = "live"

    def __init__(self, fee: FeeModel, prefer_maker: bool):
        require_live_ack()
        key = os.environ.get("POLY_PRIVATE_KEY")
        if not key:
            raise RuntimeError("live mode requires POLY_PRIVATE_KEY")
        try:
            from py_clob_client.client import ClobClient  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("pip install py-clob-client for live mode") from e
        self.fee = fee
        self.prefer_maker = prefer_maker
        self.client = ClobClient("https://clob.polymarket.com", key=key, chain_id=137,
                                 signature_type=int(os.environ.get("POLY_SIG_TYPE", "0")),
                                 funder=os.environ.get("POLY_FUNDER") or None)
        self.client.set_api_creds(self.client.create_or_derive_api_creds())

    def _limit(self, token_id: str, price: float, size: float, side: str) -> str:
        from py_clob_client.clob_types import OrderArgs  # type: ignore
        from py_clob_client.order_builder.constants import BUY, SELL  # type: ignore
        args = OrderArgs(price=round(price, 2), size=round(size, 2), side=BUY if side == "BUY" else SELL,
                         token_id=token_id)
        signed = self.client.create_order(args)
        resp = self.client.post_order(signed)
        return str(resp.get("orderID") or resp.get("id") or "")

    def buy(self, token_id: str, book: Book, usd: float, tick: float) -> Fill | None:
        ask = book.best_ask
        if ask is None:
            return None
        if self.prefer_maker and book.best_bid is not None and ask - book.best_bid > tick + 1e-9:
            price, maker = round(book.best_bid + tick, 2), True    # rest inside the spread, no fee
        else:
            price, maker = ask, False                                # cross the spread
        shares = usd / price
        oid = self._limit(token_id, price, shares, "BUY")
        cost = shares * price + (0.0 if maker else self.fee.entry_fee(price, shares))
        return Fill(order_id=oid, shares=shares, avg_price=cost / shares, cost_usd=cost, maker=maker)

    def sell(self, token_id: str, book: Book, shares: float, tick: float) -> Fill | None:
        bid = book.best_bid
        if bid is None:
            return None
        oid = self._limit(token_id, bid, shares, "SELL")
        net = shares * bid - self.fee.entry_fee(bid, shares)
        return Fill(order_id=oid, shares=shares, avg_price=net / shares, cost_usd=net, maker=False)
