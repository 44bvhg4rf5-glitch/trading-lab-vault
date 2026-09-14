"""Daily digest written in the vault's frontmatter-markdown style."""
from __future__ import annotations

from datetime import datetime, timezone

from . import calibration
from .config import DIGEST_DIR, Config
from .engine import ScanReport, status


def write_digest(cfg: Config, rep: ScanReport | None = None, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    s = status(cfg)
    cal = calibration.load()
    day = now.date().isoformat()
    lines = ["---", f"date: {day}", f"mode: {s['mode']}", f"equity_usd: {s['equity_usd']}",
             f"equity_gbp: {s['equity_gbp']}", f"floor_usd: {s['floor_usd']}",
             f"banked_tools_usd: {s['banked'].get('tools', 0)}", f"banked_owner_usd: {s['banked'].get('owner', 0)}",
             "tags: [trading-lab, polymarket, daily-digest]", "---", "",
             f"# Polymarket day {day}", "",
             f"Equity **${s['equity_usd']}** (£{s['equity_gbp']}) · floor ${s['floor_usd']} · "
             f"risk budget ${s['risk_budget_usd']} · banked £{round((s['banked'].get('tools', 0) + s['banked'].get('owner', 0)) / max(cfg.get('fx_fallback_gbp_usd', 1.3), 0.5), 2)}",
             ""]
    if rep:
        lines += ["## Scan", "", f"- Markets scanned: {rep.scanned}; passed filters: {rep.tradeable}; researched: {rep.researched}",
                  f"- Filter rejections: {', '.join(f'{k} {v}' for k, v in sorted(rep.filter_counts.items()))}",
                  f"- Candidates with edge ≥ {cfg.min_edge:.0%}: {len(rep.candidates)}; entries: {len(rep.trades)}; exits: {len(rep.exits)}; settlements: {len(rep.settlements)}",
                  ""]
        if rep.candidates:
            lines += ["| Question | Side | Mkt | Ours | Edge | Conf | Stake | Status |", "|---|---|---|---|---|---|---|---|"]
            for c in rep.candidates:
                d = c.decision
                lines.append(f"| {c.market.question[:55]} | {c.side} | {d.get('price')} | {round(c.p, 3)} | "
                             f"{d.get('edge')} | {round(c.confidence, 2)} | ${d.get('stake_usd')} | {c.skipped or 'ENTERED'} |")
            lines.append("")
    if s["open_positions"]:
        lines += ["## Open positions", ""]
        for p in s["open_positions"]:
            lines.append(f"- {p['side']} {p['shares']} @ {p['avg']} (mark {p['mark']}, ours {p['p_est']}) — {p['q']}")
        lines.append("")
    lines += ["## Agent calibration (Brier, lower is better)", ""]
    mk = cal.get("market", {})
    en = cal.get("ensemble", {})
    if mk.get("n"):
        lines.append(f"- market price: {mk['brier'] / mk['n']:.4f} over {mk['n']}")
        lines.append(f"- ensemble: {en['brier'] / en['n']:.4f} over {en['n']}")
        for name, b in sorted(cal.get("agents", {}).items()):
            if b.get("n"):
                lines.append(f"- {name}: {b['brier'] / b['n']:.4f} over {b['n']} (market on same set {b['market_brier'] / b['n']:.4f})")
    else:
        lines.append("- no resolved shadow estimates yet")
    lines.append("")
    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    path = DIGEST_DIR / f"{day}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)
