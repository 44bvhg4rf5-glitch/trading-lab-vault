# Prediction-market Kelly bot (Polymarket + Smarkets)

A self-contained, zero-cost research-and-trading system for binary prediction markets.
It lives in this vault so its journals, digests and calibration record sit next to the
rest of the Trading Lab.

**Read the "What this system cannot promise" section before anything else.**

## Two venues, one engine

| | Polymarket | Smarkets |
|---|---|---|
| role | free signal source + paper calibration | the live venue (UK Gambling Commission licensed) |
| access from the UK | blocked (close-only) | allowed |
| contract | YES/NO share priced 0–1 in USDC | back (= YES) or lay (= NO) at probability 0–1 in GBP |
| fees | taker fee on entry, `rate·p·(1−p)` | ~2 % commission on net winnings per market |
| config | `config.json` | `config.smarkets.json` |
| state | `state/polymarket/` | `state/smarkets/` |
| minimum stake | 5 shares | £0.05 |

Everything above the venue adapter is shared: the research agents, the ensemble, Kelly
sizing, the capital floor, the 40/40/20 split, the shadow ledger and calibration. On
Smarkets the `polymarket_price` agent reads Polymarket's price on the matching question
for free and treats it as a second crowd; a compatibility guard (negation, numbers,
antonyms, party names) stops it pairing a question with its opposite.

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
   | `polymarket_price` | Polymarket Gamma search | Polymarket's own price when trading elsewhere (Smarkets) |

   Agents that cannot reach their source simply abstain. Nothing here spends paid API usage.
4. **Ensemble** — pools agent log-odds weighted by confidence, then **shrinks toward the
   market price**; disagreement and news storms shrink harder. The market is the strongest
   free forecaster there is, so we only step away from it when independent evidence agrees.
5. **Kelly** — for the better of YES/NO: `f* = p − (1 − p) / b` where `b` is the net odds
   after the venue's fee model (taker fee on Polymarket, commission on winnings on
   Smarkets). Trade only if `p − breakeven ≥ 8 %` (`min_edge`). Stake = ¼ Kelly
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

The bot never moves money. When you actually withdraw from the venue to your bank, record
it so the ledger matches reality:

```bash
python3 run.py --config config.smarkets.json withdraw --pot owner --amount 12.50 --note "to Monzo"
```

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
  This code does nothing to bypass restrictions; that is why the live venue for a UK
  account is Smarkets. Paper mode works everywhere on both venues.
- **Smarkets is small.** Its politics and current-affairs book is a few hundred contracts,
  most resolving months out and many thinly quoted. The first dry run found 24 tradeable
  contracts and no 8 % edges. Expect a handful of real signals a week, not a stream.

## Running it

```bash
cd polymarket
python3 -m unittest discover -s tests                        # stdlib only, no installs
python3 run.py --config config.smarkets.json scan --dry-run  # Smarkets research only, ~30 s
python3 run.py --config config.smarkets.json scan --digest   # Smarkets paper trade + digest
python3 run.py scan --dry-run --max-events 60                # Polymarket research only, ~2 min
python3 run.py scan --digest                                 # Polymarket paper trade + digest
python3 run.py --config config.smarkets.json status
python3 run.py --config config.smarkets.json loop --interval 900
python3 run.py projection                                    # the growth arithmetic
```

## Running it with no computer (phone only)

The bot runs on GitHub's hosted runners for free (`.github/workflows/polymarket-scan.yml`):
Smarkets every hour, Polymarket paper every 6 hours, each run about a minute. Everything
you need is in the **GitHub mobile app** or the GitHub website in your phone browser.

One-time setup, from the phone:

1. **Merge this branch into `main`.** Scheduled workflows only run from the default branch.
   Open the repository → Pull requests → create one from
   `claude/polymarket-kelly-trading-fwq6jf` → merge.
2. **Enable Actions**: repository → Actions tab → enable workflows if prompted. You can tap
   "Run workflow" on `prediction-bot` to run it immediately.
3. **Turn on notifications** for the repository (bell icon → "All activity" or at least
   Issues). Every time the bot enters, exits, settles or splits profit it opens an issue
   titled "Bot activity …", which is what pings your phone. A failing run also notifies.

Day to day:

- **Results**: the bot commits state and digests to the `polymarket-bot-state` branch (not
  `main`, so it never collides with the Trading Lab app). Switch branch in the app and open
  `polymarket/digests/smarkets-<date>.md`. Each run's page under Actions also shows a summary
  table (equity, floor, budget, exposure, banked) and the run's events.
- **Change a setting**: open `polymarket/config.smarkets.json` on `main`, tap the pencil,
  edit (e.g. `min_edge`, `kelly_fraction`), commit. The next hourly run picks it up.
- **Pause**: Actions → `prediction-bot` → "…" → Disable workflow. Re-enable the same way.
- **Withdrawals**: after you move money out of Smarkets, log it so the reserves stay
  honest: run the `withdraw` command from a Claude Code session on your phone, or edit
  `reserves` in `polymarket/state/smarkets/state.json` on the state branch.

Going live from the phone, only after the paper period has earned it:

1. Repository → Settings → Secrets and variables → Actions → add `SMARKETS_USERNAME`,
   `SMARKETS_PASSWORD` and `PM_LIVE_ACK` = `I_UNDERSTAND`.
2. Edit `polymarket/config.smarkets.json` on `main`: `"mode": "live"`, and set
   `bankroll_gbp` to what you deposited.
3. The paper ledger and the live ledger are the same files; run `reset --confirm` from a
   Claude session (or delete `polymarket/state/smarkets/` on the state branch) so the live
   account starts from your real deposit rather than the paper balance.

Costs: a private repository gets 2,000 free Actions minutes a month; this schedule uses
roughly 900. Do not run it more often than hourly without checking that budget. Anything
that needs a terminal (`withdraw`, `reset`, `projection`) can be run from the Claude Code
mobile app in a session on this repository, but that uses Claude usage; the schedule itself
does not.

### The plan

1. Run both venues in paper mode for two to three weeks.
2. Judge the system on the calibration table in the daily digest: the ensemble must beat
   the market price's Brier score on resolved questions before any real money goes in.
3. Open a Smarkets account, ask Smarkets for API-user access (order placement returns 403
   without it), fund it with £50, and switch `config.smarkets.json` to live.
4. Keep the floor: £10 maximum drawdown, 90 % of gains locked, 40/40/20 on new highs.

Optional free upgrades (no paid tokens):

- `OLLAMA_HOST` / `OLLAMA_MODEL` — run a local model; the `local_llm` agent switches on automatically.
- `METACULUS_TOKEN` — free account token enables the `metaculus` agent.

### Live mode (deliberately awkward to switch on)

Both venues require `"mode": "live"` in the config (or `PM_MODE=live`) **and**
`PM_LIVE_ACK=I_UNDERSTAND` in the environment.

- **Smarkets**: `SMARKETS_USERNAME` and `SMARKETS_PASSWORD` for an account with API-user
  access. Orders are immediate-or-cancel at the best quote, snapped to the exchange's
  odds tick ladder; a NO position is a lay of the contract. Stdlib only, nothing to install.
- **Polymarket** (only where permitted): `POLY_PRIVATE_KEY` (and `POLY_FUNDER` /
  `POLY_SIG_TYPE` for proxy wallets) and `pip install py-clob-client`. Entries rest as maker
  limit orders one tick inside the spread when there is room, otherwise cross the spread.

Reconcile fills with `status` before trusting the paper-style ledger.

## Layout

```
polymarket/
  run.py                  CLI (scan, loop, status, digest, withdraw, projection, reset)
  config.json             Polymarket knobs (edge, Kelly fraction, floor, split, filters, agents)
  config.smarkets.json    Smarkets knobs
  pm/
    venues/               base.py (interface), polymarket.py, smarkets.py (API, odds mapping, live orders)
    clients/              gamma.py (discovery), clob.py (books/history), fx.py (GBP/USD)
    research/             agents.py, ensemble.py, text.py, registry.py
    kelly.py              binary Kelly with fee models (taker fee / commission)
    risk.py               floor, budget, caps, filters, daily halt
    treasury.py           40/40/20 split
    execution.py          paper executor + Polymarket live executor
    engine.py             scan / manage cycle, withdraw
    calibration.py        Brier scoring -> agent weights
    ledger.py, state.py   journals and account state (per venue)
    paths.py              per-venue state locations
    digest.py             vault-style daily markdown
  state/<venue>/          state.json, journal.jsonl, shadow.jsonl, calibration.json
  digests/                <venue>-YYYY-MM-DD.md
  tests/                  37 unit tests (stdlib unittest)
```
