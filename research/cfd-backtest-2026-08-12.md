---
date: 2026-08-12
tags: [trading-lab, backtest, bootcamp, cfd]
---

# CFD backtest bootcamp — 2026-08-12

Replayed both CFD strategies over OANDA practice history (daily: ~8 years; H1: ~10 months) on SPX500_USD, NAS100_USD, UK100_GBP, XAU_USD, 0.1R friction charged per trade (spread + a stand-in for overnight financing, which is not modelled per-day). Split 70/30 by time: "out-of-sample" is the part the eye hadn't seen. The exit simulator applies the live book's trailing stop.

## Momentum breakout (H1)

- In-sample: 136 trades · 50% wins · avg 0.12R · total 16R · maxDD -9.91R · worst streak 7
- Out-of-sample: 64 trades · 44% wins · avg -0.15R · total -9.5R · maxDD -21.17R · worst streak 10

## Mean reversion (daily, incubating)

- In-sample: no trades
- Out-of-sample: no trades

## Caveats (read before believing)

- Practice-feed mid prices; real spreads vary by session (wider overnight) — the flat friction charge is an average, not a model.
- Max-hold timeouts use each strategy's current champion config (momentum 5d, mean-reversion 14d calendar).
- No parameter changes are made from this report. Changes go through the CFD evolution loop's promotion gate.
