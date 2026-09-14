from __future__ import annotations

from ..config import Config
from .agents import (EventConsistencyAgent, FavoriteLongshotAgent, LocalLLMAgent, ManifoldAgent,
                     MetaculusAgent, MomentumAgent, NewsAgent, OrderBookAgent, PolymarketPriceAgent,
                     TimeDecayAgent)
from .base import Agent

AGENT_CLASSES: dict[str, type[Agent]] = {
    c.name: c for c in (EventConsistencyAgent, OrderBookAgent, MomentumAgent, TimeDecayAgent,
                        FavoriteLongshotAgent, ManifoldAgent, MetaculusAgent, PolymarketPriceAgent, NewsAgent,
                        LocalLLMAgent)
}


def build_agents(cfg: Config) -> list[Agent]:
    out: list[Agent] = []
    for name, cls in AGENT_CLASSES.items():
        if not cfg.agent_enabled(name):
            continue
        params = dict(cfg.get(f"agents.{name}", {}) or {})
        params.pop("enabled", None)
        weight = float(params.pop("weight", 1.0))
        out.append(cls(weight=weight, **params))
    return out
