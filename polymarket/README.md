# Polymarket Kelly bot

A self-contained, zero-cost research-and-trading system for Polymarket binary markets.
It lives in this vault so its journals, digests and calibration record sit next to the
rest of the Trading Lab.

**Read the "What this system cannot promise" section before anything else.**

## What it does

Every cycle (`python run.py scan`):

1. **Discover** — pulls every active event from Polymarket's free Gamma API (≈1,400 binary
   markets) and reads live order books from the free CLOB API. No keys, no tokens.
2. **Filter** — drops anything thin, wide, extreme-priced, resolving in < 6 h or > 45 days.
3. **Research with free agents** — each agent produces an independent probability:

   | agent | source | what it knows |
   |---|---|---|
   | `event_consistency` | Polymarket sibling markets | mutually exclusive outcomes must sum to 1; also flags YES+NO < $1 arbitrage |
   | `orderbook` | CLOB depth | micro-price from bid/ask imbalance |
   | `momentum` | CLOB price history | prediction markets under-react; 24 h moves continue a little |
   | `time_decay` | question text + clock | "will X happen *by* date" markets stay overpriced as the deadline nears |
   | `favorite_longshot` | price | classic longshot-overpricing bias |
   | `manifold` | Manifold Markets public API | a second crowd's forecast on matching questions |
   | `metaculus` | Metaculus API (free token) | superforecaster community estimate |
   | `news` | Google News RSS | headline bursts → trust stale signals less |
   | `local_llm` | Ollama on your own machine | a calibrated-forecaster prompt; free local tokens only |

   Agents that cannot reach their source simply abstain. Nothing here spends paid API usage.
4. **Ensemble** — pools agent log-odds weighted by confidence, then **shrinks toward the
   market price**; disagreement and news storms shrink harder. The market is the strongest
   free forecaster there is, so we only step away from it when independent evidence agrees.
5. **Kelly** — for the cheaper of YES/NO: `f* = (p − cost) / (1 − cost)` using the
   fee-inclusive cost. Trade only if `p − cost ≥ 8 %` (`min_edge`). Stake = ¼ Kelly
   (`kelly_fraction`) of the *risk capital* (equity above the floor), capped per market
   and per event.
6. **Risk gate** — see below. Then execute (paper by default), journal, and write a
   "shadow" record of every estimate for calibration.
7. **Manage** — exits when the market catches up to our estimate (edge gone) or moves
   hard against us; settles resolved markets; runs the 40/40/20 split.

### The capital floor (why the account ratchets)

```
floor  = initial × (1 − 20 %)  +  (high-water − initial) × (1 − 10 %)
budget = equity − floor − open exposure
```

A share can at worst go to $0, so *total cost of open positions = worst-case loss*.
No entry may take the worst case below the floor. The floor only rises: 90 % of every
dollar of new profit is locked away. On a £50 start, the most trading can ever lose is £10.
A 5 % daily loss halts new entries for the day.

### 40 / 40 / 20

When realised equity makes a new high, the fresh profit is split: 40 % stays in the trading
bankroll, 40 % goes to a **tools** reserve, 20 % to an **owner** reserve. Reserves are
removed from tradeable cash, so the bot can never risk them. `python run.py status` shows
the running totals; the "tools" pot is what pays for upgrades (data, compute, paid models).

### Self-improvement without tokens

Every estimate, traded or not, is logged. When the market resolves, each agent and the
market price are Brier-scored. Agents that beat the market gain weight; those that don't
lose it (shrunk toward neutral until they have ~20 samples). Weights feed straight back
into the next ensemble. The daily digest prints the table.

## What this system cannot promise

- **"Cannot lose money" is impossible.** Any position can resolve against you. What the code
  *does* guarantee is a bounded worst case (the floor) and that locked profits are never
  re-risked. Treat the initial 20 % allowance (£10) as the price of finding out whether
  the edge is real.
- **£50 → £1,000–£2,000 by October is not a realistic target** for a capital-preserving
  Kelly system. Run `python run.py projection`: at ¼ Kelly on 8 % edges, one doubling takes
  on the order of 40–100 *correct, independent* bets. Reaching 20–40× in ~7 weeks would need
  full-Kelly-or-worse sizing, which is exactly what blows accounts up and what the floor
  forbids. Expect a slow grind and judge the system on calibration first, P&L second.
- **Edges ≥ 8 % after fees are rare in liquid markets.** The first live dry run researched 60
  markets and found none. That is the correct output, not a bug; the shadow ledger keeps
  learning regardless.
- **Geoblocking.** Polymarket restricts a number of countries. At the time of writing the
  UK is in *close-only* mode (existing positions can be closed, new ones cannot be opened).
  This code does nothing to bypass restrictions and live mode should only be enabled where
  you are permitted to trade. Paper mode works everywhere.

## Running it

```bash
cd polymarket
python3 -m unittest discover -s tests        # stdlib only, no installs
python3 run.py scan --dry-run --max-events 60 # research only, ~2-4 min
python3 run.py scan --digest                  # paper trade + write digests/YYYY-MM-DD.md
python3 run.py status
python3 run.py loop --interval 900            # keep going
python3 run.py projection                     # the growth arithmetic
```

Free scheduling: `.github/workflows/polymarket-scan.yml` runs a paper scan every 3 hours on
GitHub's hosted runners and commits state + digests back to the vault. Enable it under the
repo's Actions tab (it needs the default write permission for workflows).

Optional free upgrades (no paid tokens):

- `OLLAMA_HOST` / `OLLAMA_MODEL` — run a local model; the `local_llm` agent switches on automatically.
- `METACULUS_TOKEN` — free account token enables the `metaculus` agent.

### Live mode (deliberately awkward to switch on)

Requires all of: `"mode": "live"` in `config.json` (or `PM_MODE=live`), `PM_LIVE_ACK=I_UNDERSTAND`,
`POLY_PRIVATE_KEY` (and `POLY_FUNDER` / `POLY_SIG_TYPE` for proxy wallets), and
`pip install py-clob-client`. Live entries rest as maker limit orders one tick inside the
spread when there is room (no taker fee), otherwise cross the spread. Reconcile fills with
`status` before trusting the paper-style ledger.

## Layout

```
polymarket/
  run.py                CLI
  config.json           every knob (edge, Kelly fraction, floor, split, filters, agents)
  pm/
    clients/            gamma.py (discovery), clob.py (books/history), fx.py (GBP/USD)
    research/           agents.py, ensemble.py, text.py, registry.py
    kelly.py            binary Kelly with fees
    risk.py             floor, budget, caps, filters, daily halt
    treasury.py         40/40/20 split
    execution.py        paper + live executors
    engine.py           scan / manage cycle
    calibration.py      Brier scoring -> agent weights
    ledger.py, state.py journals and account state
    digest.py           vault-style daily markdown
  state/                state.json, journal.jsonl, shadow.jsonl, calibration.json
  digests/              one markdown file per day
  tests/                28 unit tests (stdlib unittest)
```
