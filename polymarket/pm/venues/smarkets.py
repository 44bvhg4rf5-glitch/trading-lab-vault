"""Smarkets venue — a UK Gambling Commission licensed exchange with a public API.

Mapping to the venue-agnostic model:
  * a contract backed at probability p  == a YES share bought at price p
  * a contract laid at probability p    == a NO share bought at price (1 - p)
  * quotes: "offers" are resting lays you can BACK into (our asks);
            "bids" are resting backs you can LAY into (our bids)
  * price units: basis points of probability (5000 = 50%); quantity: total pot in 1/10000 GBP
  * commission is charged on net winnings per market (2% standard) -> Commission fee model
Public endpoints need no login (quotes are delayed without a session token). Placing orders
needs an approved Smarkets API user account plus SMARKETS_USERNAME / SMARKETS_PASSWORD.
"""
from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone

from ..clients.clob import Book, Level
from ..clients.gamma import Market
from ..execution import Fill, PaperExecutor, require_live_ack
from ..http import HttpError, get_json, qs
from ..kelly import Commission
from .base import Venue

API = "https://api.smarkets.com/v3"
MIN_STAKE_GBP = 0.05


def _chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def _dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# Smarkets prices must sit on the decimal-odds tick ladder.
_LADDER = [(2.0, 0.01), (3.0, 0.02), (4.0, 0.05), (6.0, 0.1), (10.0, 0.2), (20.0, 0.5),
           (30.0, 1.0), (50.0, 2.0), (100.0, 5.0), (1000.0, 10.0)]


def snap_price_bps(prob: float, side: str) -> int:
    """Round a probability to a valid exchange tick, conservatively for the given side
    (a BUY/back rounds the odds down = probability up; a SELL/lay the other way)."""
    prob = min(max(prob, 0.0101), 0.99)
    odds = 1.0 / prob
    step = next(st for lim, st in _LADDER if odds <= lim + 1e-9)
    import math
    snapped = (math.floor(odds / step) if side == "buy" else math.ceil(odds / step)) * step
    snapped = min(max(snapped, 1.01), 1000.0)
    return int(round(10000 / snapped))


class SmarketsVenue(Venue):
    name = "smarkets"
    currency = "GBP"

    def __init__(self, cfg):
        super().__init__(cfg)
        self._quotes: dict[str, dict] = {}           # contract id -> {"bids": [...], "offers": [...]}
        self._contract_market: dict[str, str] = {}   # contract id -> market id
        self._markets: dict[str, dict] = {}          # market id -> raw market
        self._events: dict[str, dict] = {}           # event id -> raw event

    # ---- discovery ----------------------------------------------------------
    def _events_for(self, domain: str, max_events: int) -> list[dict]:
        out: list[dict] = []
        url = f"{API}/events/?" + qs({"state": "upcoming", "type_domain": domain, "limit": 100,
                                      "with_new_type": "true"})
        while url and len(out) < max_events:
            d = get_json(url, ttl=300)
            for e in d.get("events", []):
                if e.get("type", {}).get("scope") == "single_event" and e.get("bettable"):
                    out.append(e)
            nxt = (d.get("pagination") or {}).get("next_page")
            url = f"{API}/events/{nxt}" if nxt else None
        return out[:max_events]

    def scan_markets(self, max_events: int) -> list[Market]:
        domains = list(self.cfg.get("venue_options.domains", ["politics", "current_affairs"]))
        events = []
        for dom in domains:
            events += self._events_for(dom, max_events)
        for e in events:
            self._events[str(e["id"])] = e
        ev_ids = [str(e["id"]) for e in events]
        raw_markets: list[dict] = []
        for ch in _chunks(ev_ids, 25):
            raw_markets += get_json(f"{API}/events/{','.join(ch)}/markets/", ttl=300).get("markets", [])
        raw_markets = [m for m in raw_markets if m.get("state") in ("open", "live")]
        for m in raw_markets:
            self._markets[str(m["id"])] = m
        m_ids = [str(m["id"]) for m in raw_markets]
        contracts: dict[str, list[dict]] = {}
        volumes: dict[str, float] = {}
        for ch in _chunks(m_ids, 25):
            for c in get_json(f"{API}/markets/{','.join(ch)}/contracts/", ttl=300).get("contracts", []):
                contracts.setdefault(str(c["market_id"]), []).append(c)
            try:
                for v in get_json(f"{API}/markets/{','.join(ch)}/volumes/", ttl=300).get("volumes", []):
                    volumes[str(v["market_id"])] = float(v.get("volume") or 0)
            except HttpError:
                pass
        self._fetch_quotes(m_ids)
        out: list[Market] = []
        for m in raw_markets:
            cs = [c for c in contracts.get(str(m["id"]), []) if c.get("state_or_outcome") in ("open", "live")]
            for c in cs:
                self._contract_market[str(c["id"])] = str(m["id"])
            out += self._to_markets(m, cs, volumes.get(str(m["id"]), 0.0))
        return out

    def _to_markets(self, m: dict, cs: list[dict], volume: float) -> list[Market]:
        ev = self._events.get(str(m.get("event_id")), {})
        end = _dt(ev.get("end_date") or ev.get("start_datetime"))
        names = {c["name"].strip().lower(): c for c in cs}
        base = dict(condition_id=str(m["id"]), slug=ev.get("full_slug", ""),
                    description=(ev.get("special_rules") or m.get("description") or ""),
                    end_date=end, volume_24h=volume, active=True, closed=False, accepting_orders=True,
                    tick=0.0001, event_title=ev.get("name"), raw=m)
        made: list[Market] = []
        if len(cs) == 2 and "yes" in names and "no" in names:
            y, n = names["yes"], names["no"]
            mid = self._mid(str(y["id"]))
            if mid is None:
                return []
            made.append(Market(id=str(m["id"]), question=f"{ev.get('name', '')}: {m['name']}".strip(": "),
                               outcomes=["Yes", "No"], outcome_prices=[mid, 1 - mid],
                               token_ids=[str(y["id"]), str(n["id"])], liquidity=self._depth(str(y["id"])),
                               neg_risk=False, min_order_size=MIN_STAKE_GBP / max(mid, 0.01),
                               event_id=None, group_item_title=None, **base))
            return made
        exclusive = int(m.get("winner_count") or 1) == 1 and len(cs) > 1
        for c in cs:
            cid = str(c["id"])
            mid = self._mid(cid)
            if mid is None:
                continue
            made.append(Market(id=f"{m['id']}:{cid}",
                               question=f"{ev.get('name', '')} — {m['name']}: {c['name']}".strip(" —:"),
                               outcomes=["Yes", "No"], outcome_prices=[mid, 1 - mid],
                               token_ids=[cid, "lay:" + cid], liquidity=self._depth(cid),
                               neg_risk=exclusive, min_order_size=MIN_STAKE_GBP / max(mid, 0.01),
                               event_id=str(m["id"]) if exclusive else None, group_item_title=c["name"], **base))
        return made

    # ---- quotes / books -----------------------------------------------------
    def _fetch_quotes(self, market_ids: list[str]) -> None:
        for ch in _chunks(market_ids, 200):
            try:
                d = get_json(f"{API}/markets/{','.join(ch)}/quotes/", ttl=60)
            except HttpError:
                continue
            for cid, q in d.items():
                if isinstance(q, dict):
                    self._quotes[str(cid)] = q

    def prefetch(self, markets: list[Market]) -> None:
        pass  # quotes are already batch-fetched in scan_markets

    def _levels(self, cid: str, side: str) -> list[Level]:
        q = self._quotes.get(cid)
        if not q:
            mkt = self._contract_market.get(cid)
            if mkt:
                self._fetch_quotes([mkt])
            q = self._quotes.get(cid, {})
        return [Level(float(x["price"]) / 10000.0, float(x["quantity"]) / 10000.0) for x in q.get(side, [])]

    def _mid(self, cid: str) -> float | None:
        b = self.get_book(cid)
        return b.mid

    def _depth(self, cid: str) -> float:
        b = self.get_book(cid)
        return b.depth_within("ask", 0.05) + b.depth_within("bid", 0.05)

    def get_book(self, token_id: str) -> Book:
        if token_id.startswith("lay:"):
            cid = token_id[4:]
            backs = self._levels(cid, "bids")      # resting backs: we can lay into them = buy NO
            lays = self._levels(cid, "offers")     # resting lays: we can back into them = sell NO
            asks = sorted((Level(1 - l.price, l.size) for l in backs), key=lambda l: l.price)
            bids = sorted((Level(1 - l.price, l.size) for l in lays), key=lambda l: -l.price)
            return Book(token_id=token_id, bids=bids, asks=asks)
        bids = sorted(self._levels(token_id, "bids"), key=lambda l: -l.price)
        asks = sorted(self._levels(token_id, "offers"), key=lambda l: l.price)
        return Book(token_id=token_id, bids=bids, asks=asks)

    # ---- refresh / resolution ------------------------------------------------
    def get_market(self, market_id: str) -> Market | None:
        mkt_id, _, cid = market_id.partition(":")
        raw = get_json(f"{API}/markets/{mkt_id}/contracts/", ttl=0).get("contracts", [])
        if not raw:
            return None
        m = self._markets.get(mkt_id)
        if m is None:
            ev_id = str(raw[0].get("event_id") or "")
            ms = get_json(f"{API}/events/{ev_id}/markets/", ttl=0).get("markets", []) if ev_id else []
            m = next((x for x in ms if str(x["id"]) == mkt_id), None)
            if m is None:
                return None
            self._markets[mkt_id] = m
            if ev_id and ev_id not in self._events:
                evs = get_json(f"{API}/events/{ev_id}/", ttl=0).get("events", [])
                if evs:
                    self._events[ev_id] = evs[0]
        for c in raw:
            self._contract_market[str(c["id"])] = mkt_id
        self._fetch_quotes([mkt_id])
        target = cid or next((str(c["id"]) for c in raw if c["name"].strip().lower() == "yes"), None)
        c = next((x for x in raw if str(x["id"]) == target), None)
        if c is None:
            return None
        outcome = c.get("state_or_outcome")
        live = [x for x in raw if x.get("state_or_outcome") in ("open", "live")]
        made = self._to_markets(m, live if outcome in ("open", "live") else raw, 0.0)
        mk = next((x for x in made if x.id == market_id), None)
        if mk is None:
            mk = Market(id=market_id, condition_id=mkt_id, question=c["name"], slug="", description="",
                        outcomes=["Yes", "No"], outcome_prices=[0.5, 0.5], token_ids=[target, "lay:" + target],
                        end_date=None, liquidity=0, volume_24h=0, neg_risk=False, active=False, closed=True,
                        accepting_orders=False, min_order_size=1, tick=0.0001, raw=m)
        if outcome == "winner":
            mk.closed, mk.active, mk.outcome_prices = True, False, [1.0, 0.0]
        elif outcome == "loser":
            mk.closed, mk.active, mk.outcome_prices = True, False, [0.0, 1.0]
        elif outcome in ("voided", "deadheat", "reduced"):
            mk.closed, mk.active = True, False
            mk.raw = dict(mk.raw, voided=True)
        elif m.get("state") in ("settled", "voided", "halted", "unavailable"):
            mk.closed = True
        return mk

    # ---- economics / execution ----------------------------------------------
    def fee_model(self):
        return Commission(float(self.cfg.get("fees.commission_rate", 0.02)))

    def build_executor(self, mode: str):
        if mode == "live":
            return SmarketsLiveExecutor(self)
        return PaperExecutor(self.fee_model())


class SmarketsLiveExecutor:
    """Immediate-or-cancel orders through the Smarkets trading API (API-user accounts only)."""
    name = "live"

    def __init__(self, venue: SmarketsVenue):
        require_live_ack()
        user, pw = os.environ.get("SMARKETS_USERNAME"), os.environ.get("SMARKETS_PASSWORD")
        if not user or not pw:
            raise RuntimeError("live mode requires SMARKETS_USERNAME and SMARKETS_PASSWORD")
        self.venue = venue
        self.fee = venue.fee_model()
        req = urllib.request.Request(f"{API}/sessions/", data=json.dumps({"username": user, "password": pw}).encode(),
                                     headers={"Content-Type": "application/json", "User-Agent": "trading-lab-polymarket/0.1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            self.token = json.loads(r.read().decode())["token"]

    def _order(self, market_id: str, contract_id: str, side: str, price_bps: int, pot_units: int) -> dict:
        body = {"market_id": market_id, "contract_id": contract_id, "side": side, "price": price_bps,
                "quantity": pot_units, "type": "immediate_or_cancel", "minimum_accepted_quantity": 0,
                "label": "kelly-bot"}
        req = urllib.request.Request(f"{API}/orders/", data=json.dumps(body).encode(), headers={
            "Content-Type": "application/json", "Authorization": f"Session-Token {self.token}",
            "User-Agent": "trading-lab-polymarket/0.1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())

    def _place(self, token_id: str, price: float, shares: float, closing: bool) -> Fill | None:
        lay = token_id.startswith("lay:")
        cid = token_id[4:] if lay else token_id
        mkt = self.venue._contract_market.get(cid)
        if not mkt:
            return None
        # a NO share at price q is a lay of the contract at probability 1 - q
        contract_prob = 1 - price if lay else price
        side = ("buy" if not lay else "sell") if not closing else ("sell" if not lay else "buy")
        bps = snap_price_bps(contract_prob, side)
        resp = self._order(mkt, cid, side, bps, int(round(shares * 10000)))
        filled_pot = (int(round(shares * 10000)) - int(resp.get("available_quantity") or 0)) / 10000.0
        if filled_pot <= 0:
            return None
        exec_bps = resp.get("executed_avg_price") or bps
        got_prob = exec_bps / 10000.0
        share_price = 1 - got_prob if lay else got_prob
        return Fill(order_id=str(resp.get("id") or resp.get("order_id") or ""), shares=filled_pot,
                    avg_price=share_price, cost_usd=filled_pot * share_price, maker=False)

    def buy(self, token_id: str, book: Book, usd: float, tick: float) -> Fill | None:
        ask = book.best_ask
        if ask is None:
            return None
        return self._place(token_id, ask, usd / ask, closing=False)

    def sell(self, token_id: str, book: Book, shares: float, tick: float) -> Fill | None:
        bid = book.best_bid
        if bid is None:
            return None
        return self._place(token_id, bid, shares, closing=True)
