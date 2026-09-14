"""Score every agent against reality and re-weight it. This is how the system improves
without spending a single paid token: it learns which free signals actually predict.

For each resolved shadow record we compute the Brier score of each agent's estimate and of
the market price at the time. An agent that beats the market gets weight > 1; one that
loses gets < 1; everything is shrunk toward 1 until it has enough samples.
"""
from __future__ import annotations

import json
from pathlib import Path

from .config import STATE_DIR


def _path() -> Path:
    return STATE_DIR / "calibration.json"


def load() -> dict:
    p = _path()
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"agents": {}, "market": {"n": 0, "brier": 0.0}, "ensemble": {"n": 0, "brier": 0.0}}


def save(c: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps(c, indent=2, sort_keys=True), encoding="utf-8")


def score(c: dict, record: dict, outcome_yes: int) -> None:
    """record = shadow row with 'market_p', 'ensemble_p', 'estimates': [{agent,p}]."""
    y = float(outcome_yes)

    def add(bucket: dict, p: float) -> None:
        bucket["n"] = bucket.get("n", 0) + 1
        bucket["brier"] = bucket.get("brier", 0.0) + (p - y) ** 2

    add(c["market"], float(record["market_p"]))
    add(c["ensemble"], float(record["ensemble_p"]))
    for e in record.get("estimates", []):
        if e.get("p") is None:
            continue
        b = c["agents"].setdefault(e["agent"], {"n": 0, "brier": 0.0, "market_brier": 0.0})
        add(b, float(e["p"]))
        b["market_brier"] = b.get("market_brier", 0.0) + (float(record["market_p"]) - y) ** 2


def skill_weights(c: dict, base: dict[str, float], shrink_n: int = 20) -> dict[str, float]:
    """weight = base * skill, skill in [0.25, 2], shrunk toward 1 by n/(n+shrink_n)."""
    out: dict[str, float] = {}
    for name, w in base.items():
        b = c.get("agents", {}).get(name)
        if not b or b.get("n", 0) == 0:
            out[name] = w
            continue
        n = b["n"]
        agent_b = b["brier"] / n
        mkt_b = b["market_brier"] / n
        # relative skill: >1 when agent beats the market
        raw = (mkt_b + 1e-6) / (agent_b + 1e-6)
        raw = max(0.25, min(2.0, raw))
        lam = n / (n + shrink_n)
        out[name] = w * (lam * raw + (1 - lam) * 1.0)
    return out
