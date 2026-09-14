"""Per-venue state and digest locations. Set once at startup with use_venue()."""
from __future__ import annotations

from pathlib import Path

from .config import DIGEST_DIR, STATE_DIR

_venue = "polymarket"


def use_venue(name: str) -> None:
    global _venue
    _venue = name


def venue() -> str:
    return _venue


def state_dir() -> Path:
    return STATE_DIR / _venue


def digest_dir() -> Path:
    return DIGEST_DIR


def cache_dir() -> Path:
    return STATE_DIR / "cache"
