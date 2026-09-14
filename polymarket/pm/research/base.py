from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from ..clients.clob import Book
from ..clients.gamma import Market


@dataclass
class Estimate:
    agent: str
    p: float | None                 # probability that YES resolves true; None = no opinion
    confidence: float               # 0..1 — how much to trust this estimate
    rationale: str
    uncertainty: float = 0.0        # extra doubt injected by context agents (news storms etc.)
    flags: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"agent": self.agent, "p": None if self.p is None else round(self.p, 4),
                "confidence": round(self.confidence, 3), "rationale": self.rationale,
                "uncertainty": round(self.uncertainty, 3), "flags": self.flags}


@dataclass
class MarketContext:
    market: Market
    book_yes: Book
    book_no: Book
    siblings: list[Market]
    sibling_mids: dict[str, float]          # market id -> YES mid for siblings (from Gamma prices)
    history: list[tuple[int, float]]        # (unix ts, YES price)
    now: datetime
    headline_loader: Callable[[], list[dict]] | None = None
    _headlines: list[dict] | None = None

    @property
    def mid(self) -> float:
        m = self.book_yes.mid
        return m if m is not None else self.market.yes_price

    @property
    def hours_left(self) -> float | None:
        return self.market.hours_to_resolution(self.now)

    def headlines(self) -> list[dict]:
        if self._headlines is None:
            self._headlines = self.headline_loader() if self.headline_loader else []
        return self._headlines


class Agent:
    name = "base"

    def __init__(self, weight: float = 1.0, **params):
        self.weight = weight
        self.params = params

    def estimate(self, ctx: MarketContext) -> Estimate | None:  # pragma: no cover - interface
        raise NotImplementedError


# ---- shared maths ----------------------------------------------------------
def clamp(x: float, lo: float = 0.01, hi: float = 0.99) -> float:
    return max(lo, min(hi, x))


def logit(p: float) -> float:
    p = clamp(p, 1e-4, 1 - 1e-4)
    return math.log(p / (1 - p))


def expit(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1 / (1 + z)
    z = math.exp(x)
    return z / (1 + z)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
