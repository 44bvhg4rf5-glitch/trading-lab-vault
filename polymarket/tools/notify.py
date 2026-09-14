#!/usr/bin/env python3
"""Summarise what the scans did since RUN_START and produce phone-friendly output.

  * writes a markdown report to $GITHUB_STEP_SUMMARY (shows on the run page in the GitHub app)
  * writes events.md when there was a trade, exit, settlement or distribution — the workflow
    turns that into a GitHub issue, which is what actually pings your phone
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pm import engine, paths  # noqa: E402
from pm.config import load_config  # noqa: E402

VENUES = [("polymarket", "config.json"), ("smarkets", "config.smarkets.json")]
INTERESTING = {"entry", "exit", "distribution", "withdrawal", "account-opened"}


def since(path: Path, start: datetime) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
            if datetime.fromisoformat(r["t"]) >= start:
                out.append(r)
        except (ValueError, KeyError):
            continue
    return out


def fmt_event(r: dict) -> str:
    t = r["type"]
    if t == "entry":
        p = r["position"]
        d = r.get("decision", {})
        return (f"- **ENTRY** {p['side']} {p['shares']:.2f} @ {p['avg_price']:.3f} "
                f"(cost {p['cost_usd']:.2f}, edge {d.get('edge', 0):+.3f}, ours {r.get('p', 0):.3f}) — {p['question'][:90]}")
    if t == "exit" and r.get("position") is None:
        return "- **EXIT**"
    if t == "exit":
        p = r["position"]
        return f"- **EXIT** {p['close_reason']} pnl {p['pnl_usd']:+.2f} — {p['question'][:90]}"
    if t == "distribution":
        return (f"- **40/40/20 SPLIT** profit {r['profit']:.2f}: reinvest {r['reinvest']:.2f}, "
                f"tools {r['tools']:.2f}, owner {r['owner']:.2f}")
    if t == "withdrawal":
        return f"- **WITHDRAWAL** {r['amount_gbp']:.2f} GBP from {r['pot']} ({r.get('note', '')})"
    if t == "account-opened":
        amt = r.get("bankroll", r.get("bankroll_usd", 0.0))
        return f"- **ACCOUNT OPENED** {amt:.2f} {r.get('currency', 'USD')} (paper)"
    return f"- {t}"


def main() -> None:
    start = datetime.fromisoformat(os.environ.get("RUN_START") or datetime.now(timezone.utc).isoformat())
    report: list[str] = [f"# Prediction bot run {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC", ""]
    events_md: list[str] = []
    for venue, cfg_file in VENUES:
        try:
            cfg = load_config(ROOT / cfg_file)
            s = engine.status(cfg)
        except Exception as ex:  # never fail the workflow because of the summary
            report.append(f"## {venue}: status unavailable ({ex})\n")
            continue
        sym = "£" if s["currency"] == "GBP" else "$"
        report += [f"## {venue} ({s['mode']})", "",
                   f"| equity | floor | risk budget | exposure | banked | total £ |", "|---|---|---|---|---|---|",
                   f"| {sym}{s['equity']} | {sym}{s['floor']} | {sym}{s['risk_budget']} | {sym}{s['exposure']} | "
                   f"£{s['banked_gbp']} | £{s['total_incl_banked_gbp']} |", ""]
        if s["halted"]:
            report.append(f"**HALTED**: {s['halt_reason']}\n")
        for p in s["open_positions"]:
            report.append(f"- open: {p['side']} {p['shares']} @ {p['avg']} (mark {p['mark']}, ours {p['p_est']}) — {p['q']}")
        rows = [r for r in since(paths.state_dir() / "journal.jsonl", start) if r["type"] in INTERESTING]
        if rows:
            report += ["", "### Events this run", ""] + [fmt_event(r) for r in rows]
            events_md += [f"### {venue}", ""] + [fmt_event(r) for r in rows] + [""]
        report.append("")
    text = "\n".join(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    print(text)
    if events_md:
        (ROOT / "events.md").write_text("\n".join(events_md), encoding="utf-8")


if __name__ == "__main__":
    main()
