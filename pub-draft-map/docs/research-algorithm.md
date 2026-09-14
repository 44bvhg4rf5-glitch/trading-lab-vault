# The research algorithm

One workflow, followed by every worker: a Claude Code subagent reading a brief, `scripts/research-worker.ts` on Gemini, OpenAI or Anthropic, or a person with a browser. Same inputs, same decisions, same output record, so results from any of them merge in one import. If a worker does something this page does not say, it is wrong.

## Units of work

- **Pub.** One row in the `Pub` table, identified by our id and by its OpenStreetMap id.
- **Packet.** One JSON file per pub with everything a worker may read: the pub's details, its website if known, excerpts of pages on that site that mention drinks, text of any drinks PDF, and photos the site labels as a menu, board, taps or pumps, saved to disk. Built by `npm run research:packets`. Workers never crawl a site themselves.
- **Area (shard).** A geographic cell of roughly 150 to 200 pubs, built by `research-packets.ts --shards N`. One worker per area, never two. Areas are listed in `.cache/research/shards.json`.
- **Results file.** `results/<area>.json`, a JSON array with one record per pub, appended after every pub so a worker can stop and resume.

## The steps, per pub

1. **Skip if done.** If the pub already has a record in the results file, move on.
2. **Website.**
   - If the packet has a website, use it.
   - Otherwise make **one** web search: `"<pub name>" pub <town or postcode>`. Take the first result that is the pub's own site (its own domain, or its page on its pub company's site). Never take Facebook, Instagram, TripAdvisor, WhatPub, CAMRA, Untappd, Google, Yelp or any directory or review site: they are not the pub speaking and their terms forbid it. If nothing qualifies, the pub has no website. Never search twice.
   - The same rule in code: `pickOwnSite()` in `scripts/research/lib.ts`, which every provider calls.
3. **Rebuild the packet** from the found website with `npm run research:packets -- --pub <id> --website <url>`. This fetches politely (robots.txt honoured, one request at a time, cached). A worker with fetch access may additionally read at most two drinks pages on the same domain the crawl missed. Nothing off-domain.
4. **Read.** From the packet's page text, PDF text and photos, list what the pub says is on draught:
   - Only keg, cask, tap, hand-pump, "on draught", or lines with pint or half-pint prices. Bottles, cans, wine, spirits, cocktails, soft drinks and alcohol-free lines are not draught.
   - Countries, regions, fruit flavours, category headings and marketing copy are not beers.
   - Proper spelling as the brewery writes it; ABV only if stated or well known; pint price only if shown.
   - Confidence below 0.5 is dropped. Serving `bottle` or `can` is dropped. Names matching the junk list in `scripts/research/apply.ts` are dropped.
   - Without a model (`--read none`), only whole-name matches against `data/beer-catalogue.json` count, and only where a draught word sits near the name and no bottle, can or ml wording sits beside it. That mode cannot judge a page the way a model can; it is for testing the pipeline and for sites that literally say "on draught", not for the general run.
5. **Decide.** `site_menu` if at least one draught beer or cider survives step 4. Otherwise `none`. Never infer from the pub's style, chain or area; the company-range and chain inference steps do that elsewhere with their own evidence label.
6. **Record**, then go to the next pub.

## The record

```json
{
  "pubId": "cmu…",            "osmId": "node/123",     "name": "The Albany",
  "website": "https://…",     "evidence": "site_menu",
  "beers": [ { "name": "Guinness", "brewery": "Guinness", "style": "stout", "abv": 4.2, "pricePence": 650, "url": "https://…/on-draught" } ],
  "notes": ["website found by gemini search"],
  "worker": "worker:gemini+gemini", "at": "2026-09-14T10:00:00Z"
}
```

`research-apply.ts` validates every record and rejects malformed ones without stopping the import. It writes listings with source `site:own`, upgrades inferred rows for the same beer, retires the national default guess where a real list exists, and sets `Pub.evidence` and `Pub.hidden`. A pub with `none` stays hidden unless a company import or a person later gives it evidence.

## Standard notes

Use these phrases so the results can be counted:

| Situation | Note |
|---|---|
| Searched, nothing qualifies | `no website on record; <provider> search found none` |
| Site found by search | `website found by <provider> search` |
| Site would not load or robots forbids | `site unreachable or robots-blocked` |
| Site has no drinks page | `no page on the site mentions drinks; the crawl may have missed one` |
| Drinks page but only generic copy or bottles | `drinks content found but no draught beer named` |
| Tap list is an embedded Untappd widget | `tap list is an Untappd embed (not readable here)` |
| Pub closed or now another business | `closed: <what you saw>` |
| Allowance ran out before this pub | do not write a record; stop |

## Providers and allowances

| Job | Provider | Flag | Allowance to plan around |
|---|---|---|---|
| Search | Gemini with Google Search grounding | `--search gemini` | the free tier's daily grounded-request allowance (check the current limit on your account) |
| Search | Brave Search API | `--search brave` | free plan, monthly quota per key |
| Search | Claude Code session workers | (subagent) | about 200 searches per session |
| Read | Gemini | `--read gemini` | free tier requests per day |
| Read | OpenAI | `--read openai` | your plan |
| Read | Anthropic (the app's board reader) | `--read anthropic` | pay as you go |
| Read | none | `--read none` | catalogue matching only, unlimited |

Pubs whose website is already known need no search at all: run those areas with `--search none` and any reader. Spend searches only on areas with many unknown websites.

When a provider's allowance runs out the worker exits with code 3 and the next run of the same command resumes from the results file. A one-line cron entry per area, run hourly, works through the country unattended.

## Running the country

```bash
npm run import:osm -- --uk                          # every pub (once, ~1h)
npm run enrich                                      # chain ranges from OSM tags
npm run import:menus -- --site wetherspoon          # company lists (and greeneking, allbarone)
npm run research:packets -- --all --shards 300      # ~160 pubs an area; packets for known websites
# hand out areas: e.g. area-001..100 to Gemini, 101..200 to a second key, 201..300 to Claude sessions
npm run research:worker -- --shard area-001 --search gemini --read gemini
npm run research:apply                              # any time, repeatable
```

Re-run an area later with `--again` semantics by deleting its results file; packets are cached for fourteen days.

## Quality checks after an import

- `SELECT source, count(*) FROM "TapListing" WHERE status='ACTIVE' GROUP BY 1` should show `site:own` growing and `inferred` shrinking.
- Sample twenty `site_menu` pubs at random and open the URL in each record: the beer must be on that page.
- Anything in the junk list that got through goes into `JUNK_BEER` and the import is re-run; the import retires it everywhere.
