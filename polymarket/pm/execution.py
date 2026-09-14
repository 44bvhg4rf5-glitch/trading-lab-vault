"""Executors. Paper mode simulates fills against the live order book (conservatively as a
taker). Live mode uses the official py-clob-client and is opt-in only.

LIVE TRADING IS GATED: it requires mode=live in config, PM_LIVE_ACK=I_UNDERSTAND in the
environment, and POLY_PRIVATE_KEY. Polymarket geoblocks a number of countries (the UK is in
close-only mode at the time of writing). It is your responsibility to only trade where you
are allowed to; this code does nothing to bypass any restriction.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from .clients.clob import Book
from .kelly import taker_fee_per_share


@dataclass
class Fill:
    order_id: str
    shares: float
    avg_price: float      # incl. fees
    cost_usd: float
    maker: bool


class PaperExecutor:
    name = "paper"

    def __init__(self, fee_rate: float, prefer_maker: bool):
        self.fee_rate = fee_rate
        # paper mode never assumes a maker fill it cannot verify: always price as taker
        self.prefer_maker = prefer_maker

    def buy(self, token_id: str, book: Book, usd: float, tick: float) -> Fill | None:
        shares, avg = book.fill_cost(usd)
        if shares <= 0:
            return None
        fee = taker_fee_per_share(avg, self.fee_rate) * shares
        cost = shares * avg + fee
        return Fill(order_id="paper-" + uuid.uuid4().hex[:8], shares=shares,
                    avg_price=cost / shares, cost_usd=cost, maker=False)

    def sell(self, token_id: str, book: Book, shares: float, tick: float) -> Fill | None:
        proceeds, avg = book.sell_proceeds(shares)
        if proceeds <= 0:
            return None
        sold = proceeds / avg
        fee = taker_fee_per_share(avg, self.fee_rate) * sold
        net = proceeds - fee
        return Fill(order_id="paper-" + uuid.uuid4().hex[:8], shares=sold,
                    avg_price=net / sold, cost_usd=net, maker=False)


class LiveExecutor:
    """Thin wrapper over py-clob-client. Imported lazily so paper mode has no dependency."""
    name = "live"

    def __init__(self, fee_rate: float, prefer_maker: bool):
        if os.environ.get("PM_LIVE_ACK") != "I_UNDERSTAND":
            raise RuntimeError("live mode requires PM_LIVE_ACK=I_UNDERSTAND in the environment")
        key = os.environ.get("POLY_PRIVATE_KEY")
        if not key:
            raise RuntimeError("live mode requires POLY_PRIVATE_KEY")
        try:
            from py_clob_client.client import ClobClient  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("pip install py-clob-client for live mode") from e
        self.fee_rate = fee_rate
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
            price = round(book.best_bid + tick, 2)     # rest inside the spread, pay no fee
            maker = True
        else:
            price = ask                                 # cross the spread
            maker = False
        shares = usd / price
        oid = self._limit(token_id, price, shares, "BUY")
        fee = 0.0 if maker else taker_fee_per_share(price, self.fee_rate) * shares
        cost = shares * price + fee
        return Fill(order_id=oid, shares=shares, avg_price=cost / shares, cost_usd=cost, maker=maker)

    def sell(self, token_id: str, book: Book, shares: float, tick: float) -> Fill | None:
        bid = book.best_bid
        if bid is None:
            return None
        oid = self._limit(token_id, bid, shares, "SELL")
        fee = taker_fee_per_share(bid, self.fee_rate) * shares
        net = shares * bid - fee
        return Fill(order_id=oid, shares=shares, avg_price=net / shares, cost_usd=net, maker=False)


def build_executor(mode: str, fee_rate: float, prefer_maker: bool):
    if mode == "live":
        return LiveExecutor(fee_rate, prefer_maker)
    return PaperExecutor(fee_rate, prefer_maker)
