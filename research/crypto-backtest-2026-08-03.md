---
date: 2026-08-03
tags: [trading-lab, backtest, bootcamp, crypto]
---

# Crypto backtest bootcamp — 2026-08-03

Replayed both crypto strategies over history (daily: ~3 years; 15-minute: ~90 days) on BTC/USD, ETH/USD, 0.1R friction charged per trade (wider than equities — crypto spreads run looser on the free feed). Split 70/30 by time: "out-of-sample" is the part the eye hadn't seen.

## Momentum breakout (15-minute)

- In-sample: 20 trades · 30% wins · avg -0.2R · total -4R · maxDD -9.4R · worst streak 5
- Out-of-sample: 29 trades · 34% wins · avg -0.07R · total -1.9R · maxDD -6.6R · worst streak 6

## Mean reversion (daily, incubating)

- In-sample: no trades
- Out-of-sample: no trades

## Caveats (read before believing)

- Only ~90 days of 15-minute history on the free feed — treat momentum's numbers as weak evidence, same caveat as equities.
- Max-hold timeouts are simulated using each strategy's current champion config (momentum 5d, mean-reversion 10d) — a position hitting neither stop nor target within that window exits at the bar's close.
- No parameter changes are made from this report. It is evidence, not instruction; changes go through the crypto evolution loop's promotion gate.
