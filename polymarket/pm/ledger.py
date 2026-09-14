"""Append-only journals in the vault's style (JSONL), plus the calibration store."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import paths


def _append(path: Path, rec: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {"t": datetime.now(timezone.utc).isoformat(), **rec}
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, default=str) + "\n")


def journal(rec: dict[str, Any]) -> None:
    _append(paths.state_dir() / "journal.jsonl", rec)


def shadow(rec: dict[str, Any]) -> None:
    """Every estimate we make, traded or not, so agents can be scored when markets resolve."""
    _append(paths.state_dir() / "shadow.jsonl", rec)


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return out


def rewrite_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, default=str) + "\n")
    tmp.replace(path)


def shadow_path() -> Path:
    return paths.state_dir() / "shadow.jsonl"
