"""The free research agents.

Each returns an Estimate of P(YES). None of them spend paid tokens:
  * structural agents use the order book, sibling markets and price history;
  * cross-venue agents read other public prediction sites;
  * the local-LLM agent talks to an Ollama server on your own machine if one exists.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

from ..http import get_json, get_text, post_json, HttpError
from .base import Agent, Estimate, MarketContext, clamp, expit, logit
from .text import compatible, entity_terms, implies_deadline, jaccard, keywords


# ---------------------------------------------------------------------------
class EventConsistencyAgent(Agent):
    """Mutually-exclusive outcomes must sum to 1. When they don't, each leg is mispriced.

    Also flags the pure arbitrage YES_ask + NO_ask < 1 on a single market.
    """
    name = "event_consistency"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        m = ctx.market
        flags: list[str] = []
        ya, na = ctx.book_yes.best_ask, ctx.book_no.best_ask
        if ya is not None and na is not None and ya + na < 0.995:
            flags.append(f"pair-arb: yes_ask+no_ask={ya + na:.3f}")
        if not m.neg_risk or len(ctx.siblings) < 1:
            if flags:
                return Estimate(self.name, None, 0.0, "; ".join(flags), flags=flags)
            return None
        total = ctx.mid + sum(ctx.sibling_mids.values())
        gap = total - 1.0
        tol = float(self.params.get("tolerance", 0.02))
        if abs(gap) < tol:
            return Estimate(self.name, None, 0.0,
                            f"event sums to {total:.3f} (within tolerance)", flags=flags)
        fair = clamp(ctx.mid / total)
        conf = clamp(min(1.0, abs(gap) / 0.10), 0.0, 1.0) * 0.9
        return Estimate(self.name, fair, conf,
                        f"{len(ctx.siblings) + 1} exclusive outcomes sum to {total:.3f}; "
                        f"normalised fair YES = {fair:.3f}", flags=flags + ["event-sum-gap"])


# ---------------------------------------------------------------------------
class OrderBookAgent(Agent):
    """Micro-price from top-of-book imbalance. Big resting bids push fair value up, and vice versa."""
    name = "orderbook"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        b = ctx.book_yes
        if b.best_bid is None or b.best_ask is None:
            return None
        ticks = float(self.params.get("ticks", 0.02))
        bid_depth = b.depth_within("bid", ticks)
        ask_depth = b.depth_within("ask", ticks)
        if bid_depth + ask_depth <= 0:
            return None
        w = bid_depth / (bid_depth + ask_depth)
        micro = b.best_bid + (b.best_ask - b.best_bid) * w
        # imbalance strength -> confidence; but capped low: this is a short-horizon signal
        imb = abs(w - 0.5) * 2
        conf = 0.15 + 0.35 * imb
        return Estimate(self.name, clamp(micro), conf,
                        f"bid depth ${bid_depth:,.0f} vs ask depth ${ask_depth:,.0f} within {ticks:.2f}; "
                        f"microprice {micro:.3f}")


# ---------------------------------------------------------------------------
class MomentumAgent(Agent):
    """Prediction markets under-react to news: a 24h move tends to continue a little."""
    name = "momentum"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        h = ctx.history
        if len(h) < 12:
            return None
        now_t = h[-1][0]
        p_now = h[-1][1]
        p_24 = next((p for t, p in reversed(h) if now_t - t >= 24 * 3600), None)
        p_7d = h[0][1]
        if p_24 is None:
            return None
        beta = float(self.params.get("beta", 0.25))
        d24 = p_now - p_24
        est = clamp(ctx.mid + beta * d24)
        conf = clamp(min(1.0, abs(d24) / 0.10), 0.0, 1.0) * 0.3
        return Estimate(self.name, est, conf,
                        f"24h move {d24:+.3f}, 7d move {p_now - p_7d:+.3f}; continuation beta {beta}")


# ---------------------------------------------------------------------------
class TimeDecayAgent(Agent):
    """'Will X happen by <date>' markets: if nothing has happened and little time remains,
    the YES side is usually still overpriced (people anchor on drama, not on the clock)."""
    name = "time_decay"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        m = ctx.market
        hl = ctx.hours_left
        if hl is None or not implies_deadline(m.question):
            return None
        max_h = float(self.params.get("max_hours", 96))
        if hl > max_h or hl <= 0:
            return None
        mid = ctx.mid
        if not (0.03 <= mid <= 0.45):
            return None
        # was the price drifting down or flat over the last week? (no evidence of the event)
        if ctx.history and len(ctx.history) > 6:
            if ctx.history[-1][1] - ctx.history[0][1] > 0.05:
                return None  # price rising = something is happening, stay out
        # hazard shrink: remaining fraction of a 4-day window
        shrink = 0.45 + 0.55 * (hl / max_h)
        est = clamp(mid * shrink)
        conf = 0.35 * (1 - hl / max_h) + 0.1
        return Estimate(self.name, est, conf,
                        f"deadline market, {hl:.0f}h left, no upward drift; hazard-adjusted YES {est:.3f}")


# ---------------------------------------------------------------------------
class FavoriteLongshotAgent(Agent):
    """Longshots are systematically overpriced and favourites underpriced (classic bias)."""
    name = "favorite_longshot"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        mid = ctx.mid
        k = float(self.params.get("stretch", 1.12))
        est = expit(k * logit(mid))
        conf = float(self.params.get("confidence", 0.2))
        return Estimate(self.name, clamp(est), conf, f"logit stretch x{k}: {mid:.3f} -> {est:.3f}")


# ---------------------------------------------------------------------------
class ManifoldAgent(Agent):
    """Cross-venue: Manifold Markets has a free public API with thousands of forecasts."""
    name = "manifold"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        q = ctx.market.question
        terms = {t for t in (" ".join(keywords(q, 4)), entity_terms(q)) if t}
        if not terms:
            return None
        res: dict[str, dict] = {}
        for term in terms:
            try:
                for mk in get_json("https://api.manifold.markets/v0/search-markets?" +
                                   f"term={quote_plus(term)}&limit=12", ttl=1800, timeout=15) or []:
                    res[str(mk.get("id"))] = mk
            except HttpError:
                continue
        best, best_sim = None, 0.0
        for mk in res.values():
            if mk.get("outcomeType") != "BINARY" or mk.get("isResolved"):
                continue
            if not compatible(q, mk.get("question", ""))[0]:
                continue
            sim = jaccard(q, mk.get("question", ""))
            if sim > best_sim:
                best, best_sim = mk, sim
        min_sim = float(self.params.get("min_similarity", 0.5))
        if not best or best_sim < min_sim or best.get("probability") is None:
            return None
        bettors = float(best.get("uniqueBettorCount") or 0)
        conf = best_sim * min(1.0, bettors / 40.0) * 0.8
        return Estimate(self.name, clamp(float(best["probability"])), conf,
                        f"Manifold '{best.get('question', '')[:70]}' p={best['probability']:.3f} "
                        f"(sim {best_sim:.2f}, {int(bettors)} bettors)")


# ---------------------------------------------------------------------------
class MetaculusAgent(Agent):
    """Cross-venue: Metaculus community forecasts. Needs a free API token (METACULUS_TOKEN)."""
    name = "metaculus"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        token = os.environ.get("METACULUS_TOKEN")
        if not token:
            return None
        q = ctx.market.question
        term = " ".join(keywords(q, 5))
        try:
            res = get_json("https://www.metaculus.com/api/posts/?" +
                           f"search={quote_plus(term)}&limit=8&statuses=open&forecast_type=binary",
                           ttl=1800, timeout=15, headers={"Authorization": f"Token {token}"})
        except HttpError:
            return None
        best, best_sim = None, 0.0
        for post in (res or {}).get("results", []):
            if not compatible(q, post.get("title", ""))[0]:
                continue
            sim = jaccard(q, post.get("title", ""))
            if sim > best_sim:
                best, best_sim = post, sim
        if not best or best_sim < float(self.params.get("min_similarity", 0.5)):
            return None
        try:
            agg = best["question"]["aggregations"]["recency_weighted"]["latest"]
            p = float(agg["centers"][0])
            n = float(agg.get("forecaster_count") or 0)
        except (KeyError, TypeError, ValueError, IndexError):
            return None
        conf = best_sim * min(1.0, n / 30.0) * 0.9
        return Estimate(self.name, clamp(p), conf,
                        f"Metaculus '{best.get('title', '')[:70]}' p={p:.3f} (sim {best_sim:.2f}, {int(n)} forecasters)")


# ---------------------------------------------------------------------------
def fetch_headlines(question: str, max_items: int = 15) -> list[dict]:
    """Google News RSS: free, no key. Returns [{title, published(datetime|None), source}]."""
    term = " ".join(keywords(question, 5))
    if not term:
        return []
    url = f"https://news.google.com/rss/search?q={quote_plus(term)}&hl=en-US&gl=US&ceid=US:en"
    try:
        body = get_text(url, ttl=1800, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        root = ET.fromstring(body)
    except (HttpError, ET.ParseError):
        return []
    out = []
    for item in list(root.iter("item"))[:max_items]:
        title = (item.findtext("title") or "").strip()
        pub = item.findtext("pubDate")
        try:
            dt = parsedate_to_datetime(pub) if pub else None
        except (TypeError, ValueError):
            dt = None
        src = item.findtext("source") or ""
        out.append({"title": title, "published": dt, "source": src})
    return out


class NewsAgent(Agent):
    """Free headline flow. It does not pretend to know the answer: a burst of fresh headlines
    means the situation is moving, so we trust stale structural signals less."""
    name = "news"

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        items = ctx.headlines()
        if not items:
            return None
        cutoff = ctx.now.timestamp() - 48 * 3600
        fresh = [i for i in items if i.get("published") and i["published"].timestamp() >= cutoff]
        n = len(fresh)
        unc = min(0.6, n / 15.0)
        return Estimate(self.name, None, 0.0,
                        f"{n} headlines in last 48h (of {len(items)} fetched); uncertainty +{unc:.2f}",
                        uncertainty=unc, flags=["news-burst"] if n >= 8 else [])


# ---------------------------------------------------------------------------
class LocalLLMAgent(Agent):
    """Uses a local Ollama model (free, private, no API tokens). Skips itself when no server."""
    name = "local_llm"

    def _host(self) -> str:
        return os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")

    _avail: bool | None = None   # probed once per process, not once per market

    def available(self) -> bool:
        if LocalLLMAgent._avail is None:
            try:
                get_json(self._host() + "/api/tags", timeout=3, retries=1)
                LocalLLMAgent._avail = True
            except Exception:
                LocalLLMAgent._avail = False
        return LocalLLMAgent._avail

    def estimate(self, ctx: MarketContext) -> Estimate | None:
        if not self.available():
            return None
        m = ctx.market
        heads = "\n".join(f"- {h['title']}" for h in ctx.headlines()[:10]) or "- (none)"
        prompt = (
            "You are a calibrated superforecaster. Give a probability that the following prediction "
            "market question resolves YES. Consider base rates and the time remaining. "
            "Return ONLY JSON: {\"p\": <0-1>, \"confidence\": <0-1>, \"rationale\": \"<one sentence>\"}\n\n"
            f"Question: {m.question}\nResolution rules: {m.description[:1200]}\n"
            f"Resolves at: {m.end_date}\nToday: {ctx.now.date()}\nRecent headlines:\n{heads}\n"
        )
        model = self.params.get("model") or os.environ.get("OLLAMA_MODEL", "llama3.1")
        try:
            r = post_json(self._host() + "/api/generate",
                          {"model": model, "prompt": prompt, "stream": False, "format": "json",
                           "options": {"temperature": 0.2}}, timeout=120)
            data = json.loads(r.get("response", "{}"))
            p = float(data["p"])
            conf = float(data.get("confidence", 0.5)) * float(self.params.get("trust", 0.5))
            return Estimate(self.name, clamp(p), clamp(conf, 0, 1),
                            f"{model}: {str(data.get('rationale', ''))[:160]}")
        except Exception as e:  # model output is untrusted; never let it crash the loop
            return Estimate(self.name, None, 0.0, f"local model error: {e}")
