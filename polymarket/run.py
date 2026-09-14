#!/usr/bin/env python3
"""Polymarket Kelly bot CLI.

  python run.py [--config config.smarkets.json] <command>

  scan [--dry-run] [--max-events N] [--digest]   one research + trade cycle
  loop [--interval SECONDS]                      run scan forever
  status                                         account, floor, positions
  digest                                         write today's markdown digest
  withdraw --pot tools|owner --amount GBP        record a real withdrawal from a reserve
  projection                                     what the maths says about growth
  reset --confirm                                wipe this venue's paper state

The venue (polymarket or smarkets) comes from the config file's "venue" key.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pm import engine  # noqa: E402
from pm import paths  # noqa: E402
from pm.config import load_config  # noqa: E402
from pm.digest import write_digest  # noqa: E402
from pm.kelly import expected_log_growth  # noqa: E402


def cmd_scan(args, cfg):
    rep = engine.scan(cfg, dry_run=args.dry_run, max_events=args.max_events)
    print(f"[{rep.at}] {rep.venue}: scanned {rep.scanned}, tradeable {rep.tradeable}, researched {rep.researched}")
    if rep.filter_counts:
        print("  filters:", ", ".join(f"{k}={v}" for k, v in sorted(rep.filter_counts.items())))
    print(f"  risk: equity {rep.risk['equity']:.2f} floor {rep.risk['floor']:.2f} "
          f"exposure {rep.risk['exposure']:.2f} budget {rep.risk['budget']:.2f}"
          + (f" HALTED ({rep.risk['reason']})" if rep.risk["halted"] else ""))
    for c in rep.candidates:
        d = c.decision
        print(f"  {c.side:3} edge {d['edge']:+.3f} p={c.p:.3f} mkt={d['price']:.3f} conf={c.confidence:.2f} "
              f"stake={d['stake_usd']:.2f}  {c.market.question[:70]}  -> {c.skipped or ('DRY' if args.dry_run else 'ENTERED')}")
    for e in rep.exits:
        print(f"  EXIT {e['reason']} pnl {e['pnl_usd']:+.2f}  {e['question'][:70]}")
    for s in rep.settlements:
        tag = "VOID" if s['won'] is None else ("WIN" if s['won'] else "LOSS")
        print(f"  SETTLED {tag} pnl {s['pnl_usd']:+.2f}  {s['question'][:70]}")
    if rep.distribution:
        print("  DISTRIBUTION", rep.distribution)
    if args.digest:
        print("  digest:", write_digest(cfg, rep))


def cmd_loop(args, cfg):
    while True:
        try:
            cmd_scan(args, cfg)
        except KeyboardInterrupt:
            raise
        except Exception as ex:  # keep the loop alive through API hiccups
            print("scan error:", ex, file=sys.stderr)
        time.sleep(args.interval)


def cmd_status(args, cfg):
    print(json.dumps(engine.status(cfg), indent=2))


def cmd_digest(args, cfg):
    print(write_digest(cfg))


def cmd_projection(args, cfg):
    """Honest growth arithmetic under the configured Kelly fraction and edge."""
    edge = cfg.min_edge
    frac = cfg.kelly_fraction
    print(f"Assumptions: every bet has exactly the minimum edge {edge:.0%} after fees, we bet {frac:.0%} Kelly,")
    print("the estimate is *correct on average* (this is the whole game), and capital is fully recycled.")
    print()
    print(f"{'price':>6} {'p_true':>7} {'f*':>6} {'f':>6} {'E[log g]/bet':>13} {'bets for 2x':>12} {'bets for 20x':>13}")
    for price in (0.15, 0.30, 0.50, 0.70, 0.85):
        p = price + edge
        f_full = (p - price) / (1 - price)
        f = f_full * frac
        g = expected_log_growth(p, price, f)
        n2 = math.log(2) / g if g > 0 else float("inf")
        n20 = math.log(20) / g if g > 0 else float("inf")
        print(f"{price:>6.2f} {p:>7.2f} {f_full:>6.3f} {f:>6.3f} {g:>13.5f} {n2:>12.0f} {n20:>13.0f}")
    print()
    print("Reading: with the floor limiting exposure to a fraction of equity, the realistic path from")
    print("£50 is tens of correct, uncorrelated bets per doubling — not a handful. 20-40x in ~7 weeks would")
    print("require full-Kelly-or-worse sizing, which the capital floor is designed to forbid.")


def cmd_reset(args, cfg):
    if not args.confirm:
        print("refusing: pass --confirm to wipe paper state")
        return
    if cfg.mode == "live":
        print("refusing: reset is for paper state only")
        return
    if paths.state_dir().exists():
        shutil.rmtree(paths.state_dir())
    print(f"paper state wiped for {paths.venue()}")


def cmd_withdraw(args, cfg):
    rec = engine.withdraw(cfg, args.pot, args.amount, args.note or "")
    print(json.dumps(rec, indent=2))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan"); s.add_argument("--dry-run", action="store_true"); s.add_argument("--max-events", type=int)
    s.add_argument("--digest", action="store_true"); s.set_defaults(fn=cmd_scan)
    l = sub.add_parser("loop"); l.add_argument("--interval", type=int, default=900); l.add_argument("--dry-run", action="store_true")
    l.add_argument("--max-events", type=int); l.add_argument("--digest", action="store_true"); l.set_defaults(fn=cmd_loop)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("digest").set_defaults(fn=cmd_digest)
    sub.add_parser("projection").set_defaults(fn=cmd_projection)
    r = sub.add_parser("reset"); r.add_argument("--confirm", action="store_true"); r.set_defaults(fn=cmd_reset)
    w = sub.add_parser("withdraw"); w.add_argument("--pot", choices=["tools", "owner"], required=True)
    w.add_argument("--amount", type=float, required=True, help="GBP"); w.add_argument("--note", default="")
    w.set_defaults(fn=cmd_withdraw)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    args.fn(args, cfg)


if __name__ == "__main__":
    main()
