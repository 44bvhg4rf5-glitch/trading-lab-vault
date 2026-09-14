"""The trading cycle.

scan():    discover markets -> filter -> research (free agents) -> ensemble -> Kelly -> risk gate
           -> execute -> journal + shadow record
manage():  check open positions: exit when the edge is gone (price caught up) or the thesis
           has flipped; settle positions whose market resolved; run the 40/40/20 split.
"""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from . import calibration, ledger, risk, treasury
from .clients import clob, gamma
from .clients.fx import gbp_usd
from .config import Config
from .execution import build_executor
from .kelly import decide
from .research import MarketContext, build_agents, combine
from .research.agents import fetch_headlines
from .state import Position, State, load_state, new_state, save_state


@dataclass
class Candidate:
    market: gamma.Market
    p: float
    confidence: float
    edge: float
    side: str
    decision: dict
    estimates: list[dict]
    flags: list[str]
    skipped: str = ""


@dataclass
class ScanReport:
    at: str
    scanned: int = 0
    tradeable: int = 0
    researched: int = 0
    candidates: list[Candidate] = field(default_factory=list)
    trades: list[dict] = field(default_factory=list)
    exits: list[dict] = field(default_factory=list)
    settlements: list[dict] = field(default_factory=list)
    distribution: dict | None = None
    risk: dict = field(default_factory=dict)
    filter_counts: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def ensure_state(cfg: Config) -> State:
    st = load_state()
    if st is None:
        fx = gbp_usd(float(cfg.get("fx_fallback_gbp_usd", 1.30)))
        st = new_state(round(cfg.bankroll_gbp * fx, 2), fx)
        save_state(st)
        ledger.journal({"type": "account-opened", "bankroll_usd": st.cash_usd, "gbp_usd": fx,
                        "bankroll_gbp": cfg.bankroll_gbp})
    return st


def _marks(st: State) -> dict[str, float]:
    marks: dict[str, float] = {}
    for p in st.open_positions():
        try:
            b = clob.get_book(p.token_id)
            if b.best_bid is not None:
                marks[p.token_id] = b.best_bid
        except Exception:
            continue
    return marks


# ---------------------------------------------------------------------------
def research_market(cfg: Config, m: gamma.Market, universe: list[gamma.Market], agents, weights,
                    now: datetime) -> tuple[Candidate | None, MarketContext | None, list[str]]:
    book_yes = clob.get_book(m.yes_token)
    book_no = clob.get_book(m.no_token)
    hours_left = m.hours_to_resolution(now)
    why = risk.market_filters(cfg, m, book_yes, hours_left)
    if why:
        return None, None, why
    sibs = gamma.siblings(m, universe)
    sib_mids = {s.id: s.yes_price for s in sibs}
    try:
        hist = clob.get_history(m.yes_token)
    except Exception:
        hist = []
    ctx = MarketContext(market=m, book_yes=book_yes, book_no=book_no, siblings=sibs,
                        sibling_mids=sib_mids, history=hist, now=now,
                        headline_loader=lambda: fetch_headlines(m.question))
    ests = []
    for ag in agents:
        try:
            e = ag.estimate(ctx)
        except Exception as ex:  # a broken free source must never stop the loop
            e = None
            ledger.journal({"type": "agent-error", "agent": ag.name, "market": m.id, "error": str(ex)})
        if e is not None:
            ests.append(e)
    res = combine(ctx.mid, ests, weights,
                  prior_strength=float(cfg.get("ensemble.prior_strength", 1.0)),
                  min_agents=int(cfg.get("ensemble.min_agents", 2)))
    cand = Candidate(market=m, p=res.p, confidence=res.confidence, edge=0.0, side="", decision={},
                     estimates=[e.as_dict() for e in ests], flags=sorted(set(res.flags)))
    return cand, ctx, []


def scan(cfg: Config, *, dry_run: bool = False, max_events: int | None = None,
         now: datetime | None = None) -> ScanReport:
    now = now or datetime.now(timezone.utc)
    st = ensure_state(cfg)
    rep = ScanReport(at=now.isoformat())
    agents = build_agents(cfg)
    base_w = {a.name: a.weight for a in agents}
    weights = calibration.skill_weights(calibration.load(), base_w)
    executor = build_executor(cfg.mode, cfg.taker_fee_rate, cfg.prefer_maker)

    # 1. manage what we already hold (exits, settlements, split) before adding risk
    manage(cfg, st, rep, executor, now)

    marks = _marks(st)
    equity = st.equity_usd(marks)
    risk.roll_day(st, equity, now)
    snap = risk.snapshot(cfg, st, marks, now)
    rep.risk = snap.__dict__.copy()

    universe = gamma.scan_markets(max_events=max_events or int(cfg.get("scan.max_events", 200)))
    rep.scanned = len(universe)
    universe.sort(key=lambda m: -m.volume_24h)
    max_research = int(cfg.get("scan.max_research", 60))
    open_ids = {p.market_id for p in st.open_positions()}
    min_conf = float(cfg.get("ensemble.min_confidence", 0.25))
    per_scan_cap = int(cfg.get("risk.max_new_positions_per_scan", 2))
    opened = 0
    shadow_seen = {(r.get("market_id"), r.get("day"))
                   for r in ledger.read_jsonl(ledger.STATE_DIR / "shadow.jsonl")}

    # research runs in a small thread pool (network-bound, free APIs); decisions stay sequential
    def _research(m):
        try:
            return m, research_market(cfg, m, universe, agents, weights, now)
        except Exception as ex:
            ledger.journal({"type": "research-error", "market": m.id, "error": str(ex)})
            return m, (None, None, ["error"])

    todo = [m for m in universe if m.id not in open_ids]
    workers = int(cfg.get("scan.workers", 6))
    results: list = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_research, m) for m in todo]
        for f in futs:
            results.append(f.result())
            researched = sum(1 for _, (c, _, w) in results if not w)
            if researched >= max_research:
                break
        for f in futs:
            f.cancel()

    for m, (cand, ctx, why) in results:
        if rep.researched >= max_research:
            break
        if why:
            for w in why:
                rep.filter_counts[w] = rep.filter_counts.get(w, 0) + 1
            continue
        rep.tradeable += 1
        rep.researched += 1
        assert cand is not None and ctx is not None
        budget = snap.budget if not dry_run else max(snap.budget, 0.0)
        cap = risk.position_caps(cfg, st, snap.equity, m.event_id, m.id)
        max_stake = min(budget, cap)
        dec = decide(cand.p, ctx.book_yes.best_ask, ctx.book_no.best_ask,
                     bankroll=max(snap.equity - snap.floor, 0.0), fee_rate=cfg.taker_fee_rate,
                     maker=False, fraction=cfg.kelly_fraction, min_edge=cfg.min_edge,
                     max_stake=max_stake if max_stake > 0 else 1e9)
        # shadow record for calibration, regardless of trade (one per market per day)
        if (m.id, now.date().isoformat()) not in shadow_seen:
            shadow_seen.add((m.id, now.date().isoformat()))
            ledger.shadow({"type": "estimate", "market_id": m.id, "condition_id": m.condition_id,
                           "question": m.question, "market_p": round(ctx.mid, 4),
                           "ensemble_p": round(cand.p, 4), "confidence": round(cand.confidence, 3),
                           "estimates": cand.estimates, "end_date": m.end_date.isoformat() if m.end_date else None,
                           "day": now.date().isoformat()})
        if dec is None:
            continue
        cand.edge, cand.side, cand.decision = dec.edge, dec.side, dec.as_dict()
        if cand.confidence < min_conf:
            cand.skipped = f"confidence {cand.confidence:.2f} < {min_conf}"
        elif snap.halted:
            cand.skipped = snap.reason
        elif max_stake <= 0:
            cand.skipped = "no risk budget"
        elif opened >= per_scan_cap:
            cand.skipped = "per-scan cap"
        rep.candidates.append(cand)
        if cand.skipped or dry_run:
            continue
        # 2. execute
        token = m.yes_token if dec.side == "YES" else m.no_token
        book = ctx.book_yes if dec.side == "YES" else ctx.book_no
        min_cost = m.min_order_size * dec.price
        stake = min(dec.stake_usd, max_stake)
        if stake < max(min_cost, float(cfg.get("risk.min_stake_usd", 1.0))):
            cand.skipped = f"stake ${stake:.2f} below minimum"
            continue
        fill = executor.buy(token, book, stake, m.tick)
        if not fill or fill.shares <= 0:
            cand.skipped = "no fill"
            continue
        pos = Position(id=uuid.uuid4().hex[:8], market_id=m.id, condition_id=m.condition_id,
                       question=m.question, side=dec.side, token_id=token, shares=fill.shares,
                       avg_price=fill.avg_price, cost_usd=fill.cost_usd, opened_at=now.isoformat(),
                       p_est=dec.prob, edge=dec.edge, event_id=m.event_id, order_id=fill.order_id)
        st.positions.append(pos)
        st.cash_usd -= fill.cost_usd
        opened += 1
        snap = risk.snapshot(cfg, st, marks, now)
        rec = {"type": "entry", "mode": cfg.mode, "position": pos.__dict__,
               "decision": dec.as_dict(), "p": round(cand.p, 4), "confidence": round(cand.confidence, 3),
               "estimates": cand.estimates, "flags": cand.flags}
        ledger.journal(rec)
        rep.trades.append(rec)

    st.last_scan = now.isoformat()
    st.stats = {"equity_usd": round(st.equity_usd(marks), 2), "floor_usd": round(snap.floor, 2),
                "exposure_usd": round(st.exposure_usd(), 2), "banked_usd": round(st.total_banked_usd(), 2)}
    if not dry_run:
        save_state(st)
    rep.risk = risk.snapshot(cfg, st, marks, now).__dict__.copy()
    return rep


# ---------------------------------------------------------------------------
def manage(cfg: Config, st: State, rep: ScanReport, executor, now: datetime) -> None:
    for pos in st.open_positions():
        try:
            m = gamma.get_market(pos.market_id)
        except Exception as ex:
            rep.notes.append(f"{pos.market_id}: refresh failed ({ex})")
            continue
        if m is None:
            continue
        # settlement
        outcome = m.resolved_outcome()
        if outcome is not None:
            won = (outcome == 0 and pos.side == "YES") or (outcome == 1 and pos.side == "NO")
            payout = pos.shares if won else 0.0
            _close(st, pos, payout, "resolved-win" if won else "resolved-loss", now)
            rep.settlements.append({"position": pos.id, "question": pos.question, "won": won,
                                    "pnl_usd": pos.pnl_usd})
            continue
        if m.closed:
            continue  # closed but not yet resolved: wait
        # exit logic on live book
        try:
            book = clob.get_book(pos.token_id)
        except Exception:
            continue
        bid = book.best_bid
        if bid is None:
            continue
        reason = None
        take_profit_at = pos.p_est - float(cfg.get("exits.take_profit_margin", 0.01))
        if bool(cfg.get("exits.exit_when_edge_gone", True)) and bid >= take_profit_at:
            reason = "edge-gone"
        # thesis invalidated: market moved hard against us
        stop = pos.avg_price - float(cfg.get("exits.stop_loss_abs", 0.20))
        if bid <= stop and bool(cfg.get("exits.use_stop", True)):
            reason = "stop"
        if reason:
            fill = executor.sell(pos.token_id, book, pos.shares, m.tick)
            if fill and fill.shares > 0:
                _close(st, pos, fill.cost_usd, reason, now, exit_price=fill.avg_price)
                rep.exits.append({"position": pos.id, "question": pos.question, "reason": reason,
                                  "pnl_usd": pos.pnl_usd})
    # settle shadow records for calibration
    _score_shadow(now)
    # ratchet + split
    marks = _marks(st)
    equity = st.equity_usd(marks)
    if equity > st.hwm_usd:
        st.hwm_usd = equity
    dist = treasury.maybe_distribute(cfg, st, equity, now)
    if dist:
        ledger.journal({"type": "distribution", **dist.as_dict()})
        rep.distribution = dist.as_dict()


def _close(st: State, pos: Position, proceeds: float, reason: str, now: datetime,
           exit_price: float | None = None) -> None:
    pos.status = "closed"
    pos.closed_at = now.isoformat()
    pos.close_reason = reason
    pos.exit_price = exit_price if exit_price is not None else (1.0 if proceeds > 0 else 0.0)
    pos.pnl_usd = round(proceeds - pos.cost_usd, 4)
    st.cash_usd += proceeds
    ledger.journal({"type": "exit", "position": pos.__dict__})


def _score_shadow(now: datetime) -> None:
    """Resolve shadow estimates whose end date passed; keep unresolved ones."""
    path = ledger.STATE_DIR / "shadow.jsonl"
    rows = ledger.read_jsonl(path)
    if not rows:
        return
    cal = calibration.load()
    keep: list[dict] = []
    checked: dict[str, int | None] = {}
    changed = False
    for r in rows:
        if r.get("scored"):
            keep.append(r)
            continue
        end = r.get("end_date")
        try:
            due = end and datetime.fromisoformat(end) <= now
        except ValueError:
            due = False
        if not due:
            keep.append(r)
            continue
        mid = r["market_id"]
        if mid not in checked:
            try:
                m = gamma.get_market(mid)
                checked[mid] = m.resolved_outcome() if m else None
            except Exception:
                checked[mid] = None
        out = checked[mid]
        if out is None:
            keep.append(r)
            continue
        calibration.score(cal, r, 1 if out == 0 else 0)
        r["scored"] = True
        r["outcome_yes"] = 1 if out == 0 else 0
        keep.append(r)
        changed = True
    if changed:
        calibration.save(cal)
        ledger.rewrite_jsonl(path, keep)


# ---------------------------------------------------------------------------
def status(cfg: Config) -> dict[str, Any]:
    st = ensure_state(cfg)
    marks = _marks(st)
    snap = risk.snapshot(cfg, st, marks)
    fx = st.gbp_usd or 1.3
    banked = st.total_banked_usd()
    return {
        "mode": cfg.mode,
        "equity_usd": round(snap.equity, 2), "equity_gbp": round(snap.equity / fx, 2),
        "cash_usd": round(st.cash_usd, 2), "exposure_usd": round(snap.exposure, 2),
        "floor_usd": round(snap.floor, 2), "risk_budget_usd": round(snap.budget, 2),
        "hwm_usd": round(st.hwm_usd, 2), "banked": {k: round(v, 2) for k, v in st.reserves.items()},
        "total_incl_banked_gbp": round((snap.equity + banked) / fx, 2),
        "halted": snap.halted, "halt_reason": snap.reason,
        "open_positions": [{"q": p.question[:60], "side": p.side, "shares": round(p.shares, 2),
                            "avg": round(p.avg_price, 3), "mark": marks.get(p.token_id),
                            "p_est": round(p.p_est, 3)} for p in st.open_positions()],
        "closed": len([p for p in st.positions if p.status == "closed"]),
        "last_scan": st.last_scan,
    }
