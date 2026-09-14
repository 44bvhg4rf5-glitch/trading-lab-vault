"""GBP/USD rate from the free Frankfurter API (ECB data). Falls back to a config constant."""
from __future__ import annotations

from ..http import get_json


def gbp_usd(fallback: float = 1.30) -> float:
    try:
        d = get_json("https://api.frankfurter.app/latest?from=GBP&to=USD", ttl=6 * 3600, timeout=10)
        return float(d["rates"]["USD"])
    except Exception:
        return fallback
