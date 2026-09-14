"""Venue adapters. A venue supplies markets, books, resolution and an executor; the engine,
research agents, Kelly sizing, floor and treasury are venue-agnostic."""
from __future__ import annotations

from ..config import Config
from .base import Venue


def build_venue(cfg: Config) -> Venue:
    name = cfg.get("venue", "polymarket")
    if name == "polymarket":
        from .polymarket import PolymarketVenue
        return PolymarketVenue(cfg)
    if name == "smarkets":
        from .smarkets import SmarketsVenue
        return SmarketsVenue(cfg)
    raise ValueError(f"unknown venue {name!r}")
