"""Configuration loading. Everything the strategy does is driven by config.json."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = ROOT / "config.json"
STATE_DIR = ROOT / "state"
DIGEST_DIR = ROOT / "digests"


@dataclass
class Config:
    raw: dict[str, Any] = field(default_factory=dict)

    # --- generic accessors -------------------------------------------------
    def get(self, path: str, default: Any = None) -> Any:
        node: Any = self.raw
        for key in path.split("."):
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        return node

    # --- typed shortcuts ---------------------------------------------------
    @property
    def mode(self) -> str:
        return os.environ.get("PM_MODE", self.get("mode", "paper"))

    @property
    def bankroll_gbp(self) -> float:
        return float(self.get("bankroll_gbp", 50.0))

    @property
    def min_edge(self) -> float:
        return float(self.get("min_edge", 0.08))

    @property
    def kelly_fraction(self) -> float:
        return float(self.get("kelly_fraction", 0.25))

    @property
    def taker_fee_rate(self) -> float:
        return float(self.get("fees.taker_rate", 0.07))

    @property
    def prefer_maker(self) -> bool:
        return bool(self.get("fees.prefer_maker", True))

    @property
    def split(self) -> dict[str, float]:
        return dict(self.get("split", {"reinvest": 0.4, "tools": 0.4, "owner": 0.2}))

    def agent_enabled(self, name: str) -> bool:
        return bool(self.get(f"agents.{name}.enabled", False))

    def agent_weight(self, name: str) -> float:
        return float(self.get(f"agents.{name}.weight", 1.0))


def load_config(path: str | os.PathLike | None = None) -> Config:
    p = Path(path) if path else DEFAULT_CONFIG_PATH
    with open(p, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    cfg = Config(raw=raw)
    _validate(cfg)
    return cfg


def _validate(cfg: Config) -> None:
    split = cfg.split
    total = sum(split.values())
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"split must sum to 1.0, got {total}")
    if not (0 < cfg.kelly_fraction <= 1):
        raise ValueError("kelly_fraction must be in (0, 1]")
    if not (0 <= cfg.min_edge < 1):
        raise ValueError("min_edge must be in [0, 1)")
    if cfg.mode not in {"paper", "live"}:
        raise ValueError("mode must be 'paper' or 'live'")
