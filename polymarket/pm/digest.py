"""Daily digest written in the vault's frontmatter-markdown style."""
from __future__ import annotations

from datetime import datetime, timezone

from . import calibration
from . import paths
from .config import Config
from .engine import ScanReport, status


def write_digest(cfg: Config, rep: ScanReport | None = None, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    s = status(cfg)
    cal = calibration.load()
    day = now.date().isoformat()
    cur = s["currency"]
    sym = "£" if cur == "GBP" else "$"
    lines = ["---", f"date: {day}", f"venue: {s['venue']}", f"mode: {s['mode']}", f"currency: {cur}",
             f"equity: {s['equity']}", f"equity_gbp: {s['equity_gbp']}", f"floor: {s['floor']}",
             f"banked_tools: {s['banked'].get('tools', 0)}", f"banked_owner: {s['banked'].get('owner', 0)}",
             f"tags: [trading-lab, {s['venue']}, daily-digest]", "---", "",
             f"# {s['venue'].title()} day {day}", "",
             f"Equity **{sym}{s['equity']}** (£{s['equity_gbp']}) · floor {sym}{s['floor']} · "
             f"risk budget {sym}{s['risk_budget']} · banked £{s['banked_gbp']}",
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
                             f"{d.get('edge')} | {round(c.confidence, 2)} | {sym}{d.get('stake_usd')} | {c.skipped or 'ENTERED'} |")
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
    paths.digest_dir().mkdir(parents=True, exist_ok=True)
    path = paths.digest_dir() / f"{s['venue']}-{day}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)
