"""Research agents. Every agent is free: public APIs, order-book maths, or a local model."""
from .base import Estimate, MarketContext, Agent
from .ensemble import combine, EnsembleResult
from .registry import build_agents

__all__ = ["Estimate", "MarketContext", "Agent", "combine", "EnsembleResult", "build_agents"]
