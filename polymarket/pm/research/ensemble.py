"""Combine agent estimates in log-odds space, then shrink toward the market price.

The market is the strongest single forecaster we have access to for free. We only move
away from it when several independent agents agree, and we move less when they disagree
or when the news flow says the situation is in flux.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .base import Estimate, clamp, expit, logit


@dataclass
class EnsembleResult:
    p: float                     # final probability YES
    confidence: float            # 0..1 overall trust in p (used by risk gate)
    pooled: float | None         # agents-only pooled probability (before shrinkage)
    disagreement: float          # weighted std-dev of agent log-odds
    uncertainty: float           # summed context uncertainty
    evidence: float              # total effective weight behind the pooled estimate
    contributions: list[dict] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


def combine(market_p: float, estimates: list[Estimate], weights: dict[str, float],
            prior_strength: float = 1.0, min_agents: int = 2) -> EnsembleResult:
    market_p = clamp(market_p)
    flags: list[str] = []
    unc = 0.0
    contribs: list[dict] = []
    num = 0.0
    den = 0.0
    pts: list[tuple[float, float]] = []
    for e in estimates:
        flags.extend(e.flags)
        unc += e.uncertainty
        if e.p is None or e.confidence <= 0:
            continue
        w = weights.get(e.agent, 1.0) * e.confidence
        if w <= 0:
            continue
        lo = logit(e.p)
        num += w * lo
        den += w
        pts.append((w, lo))
        contribs.append({"agent": e.agent, "p": round(e.p, 4), "w": round(w, 4)})
    if den <= 0 or len(pts) < min_agents:
        return EnsembleResult(p=market_p, confidence=0.0, pooled=None, disagreement=0.0,
                              uncertainty=unc, evidence=den, contributions=contribs, flags=flags)
    pooled_lo = num / den
    var = sum(w * (lo - pooled_lo) ** 2 for w, lo in pts) / den
    dis = math.sqrt(var)
    # shrink toward market: lambda = evidence / (evidence + prior)
    lam = den / (den + prior_strength)
    lam *= math.exp(-dis)           # disagreement -> trust the market more
    lam *= max(0.0, 1.0 - unc)      # news storm -> trust stale signals less
    final_lo = lam * pooled_lo + (1 - lam) * logit(market_p)
    return EnsembleResult(p=clamp(expit(final_lo)), confidence=clamp(lam, 0.0, 1.0),
                          pooled=clamp(expit(pooled_lo)), disagreement=dis, uncertainty=unc,
                          evidence=den, contributions=contribs, flags=flags)
