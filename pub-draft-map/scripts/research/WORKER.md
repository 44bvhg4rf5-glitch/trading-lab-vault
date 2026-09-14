# Research worker brief

You are one research worker for Draft Map, an app that lists what beer is on draught in every UK pub. You have been given one area. Other workers have the other areas; do not touch their files.

This brief is the hand-run version of `docs/research-algorithm.md`, which every worker (person, Claude subagent, or the scripted worker on Gemini or OpenAI) follows step for step. If the two ever disagree, the algorithm document wins.

Project directory: `/home/user/trading-lab-vault/pub-draft-map` (run every command from here).

## Your input

`AREA_DIR/index.json` lists your pubs: `id`, `name`, `address`, `website`, `packet`. Each packet is a JSON file with:

- `pub`: id, name, street, city, postcode, brand, operator, website
- `website`: the pub's own site, or null
- `drinksPages[]`: `{url, excerpt}`, text of pages on the site that mention drinks
- `pdfs[]`: `{url, excerpt}`, text of any drinks PDF
- `images[]`: `{url, file}`, photos the site labels as a menu, board, taps or pumps. `file` is on disk; open it with the Read tool to look at it.
- `embeds`, `notes`

## What to decide for each pub

Which beers and ciders the pub itself says are on draught: keg, cask, tap, hand pump, "on draught", or listed with pint or half prices. Only the pub's own published information counts.

Not draught, so never listed: bottles, cans, wine, spirits, cocktails, soft drinks, alcopops. Countries, regions, fruit flavours, category headings ("Lagers", "Cask ales", "4.5%") are not beers. "A great selection of ales" with no names is nothing.

## Procedure per pub

1. If the packet has drinks text, PDFs or images, read them and list the draught beers.
2. If the packet has no website (the note says so), or its site had nothing about drinks, run one WebSearch: `"<pub name>" pub <town or postcode>`. Look in the result URLs for the pub's OWN site: its own domain, or its page on a pub company site (greeneking-pubs.co.uk, fullers.co.uk, youngs.co.uk, wetherspoon.com, stonegatepubs.com, emberinns.co.uk, nicholsonspubs.co.uk, craft-pubs.co.uk, mcmullens.co.uk, brunningandprice.co.uk, hall-woodhouse.co.uk, shepherdneame.co.uk, sizzlingpubs.co.uk, vintageinn.co.uk, harvester.co.uk, tobycarvery.co.uk, chefandbrewer.com, hungryhorse.co.uk, flamingrill.co.uk, marstonspubs.co.uk, and similar).
   Never treat these as the pub's site: Facebook, Instagram, TripAdvisor, WhatPub, CAMRA, Untappd, Google, Yelp, beerintheevening, pubsgalore, inapub, allinlondon, pubsaroundme, foursquare, useyourlocal, pubshistory, or any other directory or review site. Their terms forbid it and they are not the pub speaking.
3. When you find a real site, rebuild the packet with it (this fetches politely, honouring robots.txt):
   `npx tsx scripts/research-packets.ts --pub <id> --website <url>`
   then read the rebuilt packet at the path it prints.
4. If the rebuilt packet still has no drinks page but the site clearly has a drinks or menu page you can see linked, you may WebFetch that one page on the same domain, at most two fetches per pub, with the prompt: "List every draught beer and cider named on this page with brewery, ABV and price where shown, quoting names exactly. If there is no drinks list, say so." Never WebFetch a social or directory site.
5. Evidence is `site_menu` when the pub's own site, PDF or board photo names at least one draught beer or cider. Otherwise `none`. Do not infer from the pub's style, chain or area.
6. Append the result to `RESULTS_FILE` after every pub (read the file, add the record, write it back) so progress survives. The file is a JSON array; create it if missing.

## Result record

```json
{
  "pubId": "cmu…",
  "website": "https://…" ,
  "evidence": "site_menu",
  "beers": [
    { "name": "Guinness", "brewery": "Guinness", "style": "stout", "abv": 4.2, "pricePence": 650, "url": "https://…/drinks" }
  ],
  "notes": ["drinks page lists 8 draught lines"]
}
```

- `name`: the beer's proper name as the brewery spells it (Guinness, Madrí Excepcional, Camrí, Camden Hells, Neck Oil, London Pride, Doom Bar, Amstel, Birra Moretti, Cruzcampo, Peroni Nastro Azzurro, Asahi Super Dry, Estrella Damm, Stella Artois, Carling, Foster's, Heineken, Aspall, Thatchers Gold, Inch's, Old Mout, Rekorderlig, Beavertown Neck Oil, Timothy Taylor's Landlord). Fix obvious typos on the site.
- `brewery`: the brewer if known, else null. `style`: lager, pale ale, IPA, bitter, stout, porter, cider, etc. if known, else null.
- `abv`: only if the page states it or it is well known for that beer. `pricePence`: only if the page shows a pint price (£6.50 → 650).
- `website`: the pub's own site (null if none). If the site you found turns out to be a different pub with the same name, evidence `none` and say so in notes.

## Assignment modes

Your assignment names one of these. If it names none, you are in SEARCH mode.

- **READ mode** (no web search at all). For a pub with no website in its packet, write evidence `none` with the note `no website on record; not searched` and move on at once. For a packet whose notes say the site was unreachable or had no drinks page, write `none` with that note and move on; do not fetch anything. Read every packet that has drinks pages, PDFs or images. This mode exists because the session's search allowance is shared and is spent elsewhere.
- **SEARCH mode**. Exactly one WebSearch per pub with no website on record, never a second, never another search engine; then everything in READ mode.

## Limits

Work through every pub in the index; do not stop early and do not skip any. Spend at most about three tool calls on a pub with nothing to find. Do not edit any code or any file outside `RESULTS_FILE`. When finished, reply with a short summary: how many `site_menu` and `none`, how many websites you found by search, and anything that went wrong.
