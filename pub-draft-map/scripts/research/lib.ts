/**
 * Per-pub research: find the pub's own website, crawl it for anything about
 * drinks, and pull out the beers on draught.
 *
 * Sources, in order of trust:
 *   1. Drinks / menu pages on the pub's own site (HTML text)
 *   2. PDF menus linked from those pages
 *   3. Photos on those pages that look like a board or the pumps, read by
 *      the same Claude board reader the app uses (needs ANTHROPIC_API_KEY)
 *
 * Extraction without an API key uses data/beer-catalogue.json (whole-word
 * matching against ~300 UK draught beers and breweries, plus "<name> 4.5%"
 * patterns). With a key, drinks pages are also sent to Claude, which catches
 * the long tail of guest ales and local breweries the catalogue can't.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { politeFetch, stripTags } from "../importers/lib";
import { normaliseName } from "../../src/lib/enrich";

export type FoundBeer = { name: string; brewery: string | null; abv: number | null; pricePence: number | null; via: "text" | "pdf" | "image" | "claude"; url: string; confidence: number };
export type Research = {
  website: string | null;
  websiteSource: "osm" | "search" | "none";
  pagesFetched: number;
  drinksPages: string[];
  pdfs: string[];
  imagesRead: number;
  beers: FoundBeer[];
  evidence: "site_menu" | "none";
  notes: string[];
};

// ---------------------------------------------------------------------------
// 1. Website discovery
// ---------------------------------------------------------------------------

/** Social, review, booking and directory hosts: never the pub speaking, and their terms forbid reuse. */
export const BAD_HOSTS = /facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|whatpub\.com|untappd\.com|tripadvisor|google\.|yelp\.|booking\.com|opentable|justeat|deliveroo|ubereats|wikipedia|linktr\.ee|camra\.org|beerintheevening|pubsgalore|inapub\.co|allinlondon|pubsaroundme|foursquare|useyourlocal|pubshistory|timeout\.com|yell\.com|thefork|designmynight|hitched|bing\.com|duckduckgo|apple\.com|threads\.net|linkedin|pinterest|ratebeer|beeradvocate|pubexplorer|realalepubs|closedpubs|thepubs\.uk|pub-explorer/i;

/** The pub's own website from a list of search results, or null. Same rule for every search provider. */
export function pickOwnSite(results: { url: string; title?: string | null }[], pub: { name: string }): string | null {
  const tokens = normaliseName(pub.name).split(" ").filter((w) => w.length > 2 && !["the", "inn", "pub", "hotel", "arms", "bar", "and"].includes(w));
  for (const r of results) {
    const site = cleanWebsite(r.url);
    if (!site) continue;
    const hay = normaliseName((r.title ?? "") + " " + r.url);
    if (!tokens.length || tokens.some((t) => hay.includes(t))) return new URL(site).origin;
  }
  return null;
}

export function cleanWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u = raw.trim().split(/[;\s]/)[0];
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const url = new URL(u);
    if (BAD_HOSTS.test(url.hostname)) return null; // social / aggregator pages are not the pub's site
    return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/, ""));
  } catch { return null; }
}

/**
 * Optional web search for pubs with no website on record. Uses the Brave
 * Search API when BRAVE_SEARCH_API_KEY is set; otherwise returns null and
 * the pub is researched from OSM data alone.
 */
export async function searchWebsite(pub: { name: string; city?: string | null; postcode?: string | null }): Promise<string | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  const q = `"${pub.name}" pub ${pub.city ?? ""} ${pub.postcode ?? ""}`.trim();
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?count=8&country=GB&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
  if (!res.ok) return null;
  const json = (await res.json()) as { web?: { results?: { url: string; title: string }[] } };
  return pickOwnSite(json.web?.results ?? [], pub);
}

// ---------------------------------------------------------------------------
// 2. Crawl
// ---------------------------------------------------------------------------

const DRINK_LINK = /drink|beer|ale|lager|cider|tap|menu|bar\b|what.?s.?on|brew|cask|keg|pour|draught|draft|pump|pint/i;
const STRONG_LINK = /drink|beer|tap|cask|keg|ale\b|lager|cider|draught|draft|pump|pint/i; // these go to the front of the queue
const SKIP_LINK = /\/feed\b|\/blog\b|\/news\b|\/event|\/gallery|\/careers?\b|\/privacy|\/terms|\/book|\/wp-json|\/tag\/|\/category\/|\/author\/|\?s=|\?p=|\/page\/\d+/i;
const DRINK_TEXT = /\b(on tap|on draught|on draft|on the bar|cask|keg|real ale|craft beer|guest ale|our beers|beers?\b|lagers?\b|ciders?\b|pints?\b)\b/i;
const MAX_PAGES = Number(process.env.RESEARCH_MAX_PAGES ?? 6);

function absolutise(base: string, href: string) {
  try { return new URL(href, base).toString().split("#")[0]; } catch { return null; }
}

function sameSite(a: string, b: string) {
  try { return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, ""); } catch { return false; }
}

export async function crawlForDrinks(site: string) {
  const pages: { url: string; text: string; html: string }[] = [];
  const pdfs = new Set<string>();
  const images = new Set<string>();
  const embeds = new Set<string>();
  const seen = new Set<string>();
  const queue = [site];
  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await politeFetch(url, { ttlHours: 24 * 14 });
    if (!html) continue;
    const text = stripTags(html);
    pages.push({ url, text, html });
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
      const abs = absolutise(url, m[1]);
      if (!abs) continue;
      const label = stripTags(m[2]) + " " + m[1];
      if (/\.pdf(\?|$)/i.test(abs) && DRINK_LINK.test(label)) { pdfs.add(abs); continue; }
      if (!sameSite(site, abs) || seen.has(abs) || queue.includes(abs) || SKIP_LINK.test(abs) || /\.(jpe?g|png|gif|webp|mp4|zip)(\?|$)/i.test(abs)) continue;
      if (!DRINK_LINK.test(label)) continue;
      // Drinks-specific links jump the queue so the page budget isn't spent on "menus" that turn out to be food.
      if (STRONG_LINK.test(label)) queue.unshift(abs); else queue.push(abs);
    }
    // Untappd / other embedded menus: not extractable here, but worth recording as a lead.
    if (/business\.untappd\.com\/embeds|untappd\.com\/v\//i.test(html)) embeds.add("untappd");
    // Images that the page itself labels as a menu, board, taps or pumps.
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "";
      if (!src) continue;
      const abs = absolutise(url, src);
      if (abs && /menu|board|tap|pump|draught|draft|beer|ale|bar/i.test(alt + " " + src) && /\.(jpe?g|png|webp)(\?|$)/i.test(abs)) images.add(abs);
    }
  }
  const drinksPages = pages.filter((p) => DRINK_TEXT.test(p.text));
  return { pages, drinksPages, pdfs: [...pdfs].slice(0, 4), images: [...images].slice(0, 4), embeds: [...embeds] };
}

export async function pdfText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": process.env.IMPORT_USER_AGENT ?? "DraftMapBot/0.1" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) return null;
    const parser = new PDFParse({ data: buf });
    const r = await parser.getText();
    await parser.destroy();
    return r.text;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// 3. Extraction
// ---------------------------------------------------------------------------

type CatalogueEntry = { name: string; brewery: string; style?: string; abv?: number };
let catalogue: { beers: CatalogueEntry[]; breweries: Set<string>; byKey: Map<string, CatalogueEntry> } | null = null;

export function loadCatalogue() {
  if (catalogue) return catalogue;
  const beers: CatalogueEntry[] = JSON.parse(readFileSync(path.join(process.cwd(), "data", "beer-catalogue.json"), "utf8"));
  const ranges = JSON.parse(readFileSync(path.join(process.cwd(), "data", "brand-ranges.json"), "utf8")) as { beers: Record<string, { brewery: string; style: string | null; abv: number | null }> };
  for (const [name, spec] of Object.entries(ranges.beers)) beers.push({ name, brewery: spec.brewery, style: spec.style ?? undefined, abv: spec.abv ?? undefined });
  const byKey = new Map<string, CatalogueEntry>();
  for (const b of beers) byKey.set(normaliseName(b.name), b);
  const breweries = new Set(beers.map((b) => normaliseName(b.brewery.replace(/\s*\(.*\)$/, ""))));
  catalogue = { beers, breweries, byKey };
  return catalogue;
}

/**
 * Catalogue matching on plain text. Whole-phrase, longest names first, so
 * "Strongbow Dark Fruit" is not also counted as "Strongbow". A name only
 * counts where a draught word (draught, on tap, keg, cask, pint, hand pump)
 * sits within 160 characters and no dish or bottle/can/ml wording sits right
 * beside it: without a model this is the only way to tell "Guinness £6.20 a
 * pint" from "Guinness pie" or a bottled list.
 * Then "<Something> 4.5%" lines, which are nearly always a beer on a drinks page.
 */
const DRAUGHT_CONTEXT = /draught|draft|on tap|on the bar|keg|cask|pints?\b|hand ?pump|pump clip/i;
const FOOD_CONTEXT = /\b(sea bass|bass fillet|fillet|pie|stew|gravy|batter|battered|burger|roast|sauce|marrow|bones broth|steak|fish|chips|mussels|pudding|braised|glazed|marinated|beer[- ]battered)\b/i;
const PACKAGED_CONTEXT = /\b(bottle|bottled|bottles|cans?|canned|\d{3}\s?ml|330|440|500ml)\b/i;

export function extractBeersFromText(text: string, url: string, via: FoundBeer["via"]): FoundBeer[] {
  const cat = loadCatalogue();
  const norm = " " + normaliseName(text) + " ";
  const out = new Map<string, FoundBeer>();
  const names = [...cat.byKey.keys()].sort((a, b) => b.length - a.length);
  let covered = norm;
  for (const key of names) {
    if (key.length < 4) continue;
    // First occurrence whose context reads like a drinks list (160 chars either side) and not like a dish (40 chars either side).
    let idx = -1, nth = 0;
    for (let from = 0; ; ) {
      const at = covered.indexOf(" " + key + " ", from);
      if (at < 0) break;
      const around = norm.slice(Math.max(0, at - 160), at + key.length + 160);
      const tight = norm.slice(Math.max(0, at - 25), at + key.length + 25);
      if (DRAUGHT_CONTEXT.test(around) && !FOOD_CONTEXT.test(tight) && !PACKAGED_CONTEXT.test(tight)) { idx = at; break; }
      from = at + 1;
      nth++;
    }
    if (idx < 0) continue;
    const entry = cat.byKey.get(key)!;
    // Price: first "£x.xx" within 60 chars after the same (nth) occurrence in the original text.
    const rawRe = new RegExp(key.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\W+"), "gi");
    let rawIdx = -1;
    for (let n = 0, m = rawRe.exec(text); m; m = rawRe.exec(text), n++) if (n === nth) { rawIdx = m.index; break; }
    const window = rawIdx >= 0 ? text.slice(rawIdx, rawIdx + key.length + 60) : "";
    const price = window.match(/£\s?(\d{1,2}(?:\.\d{2})?)/)?.[1];
    out.set(key, { name: entry.name, brewery: entry.brewery, abv: entry.abv ?? null, pricePence: price ? Math.round(parseFloat(price) * 100) : null, via, url, confidence: 0.85 });
    covered = covered.replace(new RegExp(" " + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " ", "g"), " # ");
  }
  // "<Name> 4.5%" — unknown beers with an ABV next to them.
  for (const m of text.matchAll(/([A-Z][A-Za-z'&]+(?:\s+[A-Z][A-Za-z'&]+){0,3})\s*[-–:|(]?\s*(\d{1,2}(?:\.\d)?)\s?%/g)) {
    const name = m[1].trim();
    const abv = parseFloat(m[2]);
    if (abv < 2 || abv > 12 || name.length < 4 || /^(ABV|Vol|Alc|Price|Pint|Half|Two|Thirds)$/i.test(name)) continue;
    const key = normaliseName(name);
    if (out.has(key) || [...out.keys()].some((k) => k.includes(key) || key.includes(k))) continue;
    const brewery = [...cat.breweries].find((b) => b.length > 3 && key.startsWith(b + " "));
    out.set(key, { name, brewery: brewery ? cat.beers.find((b) => normaliseName(b.brewery.replace(/\s*\(.*\)$/, "")) === brewery)!.brewery : null, abv, pricePence: null, via, url, confidence: 0.6 });
  }
  return [...out.values()];
}

/** Claude extraction for a drinks page: only when a key is present. */
export async function extractBeersWithClaude(text: string, url: string, pubName: string): Promise<FoundBeer[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const { readBoardText } = await import("../../src/lib/board-ocr");
  const reading = await readBoardText(text.slice(0, 12_000), { pubName });
  if (!reading.is_drinks_list) return [];
  return reading.beers
    .filter((b) => b.confidence >= 0.5 && (b.serving == null || ["draught", "keg", "cask"].includes(b.serving)))
    .map((b) => ({ name: b.name, brewery: b.brewery, abv: b.abv, pricePence: b.price_pence, via: "claude" as const, url, confidence: b.confidence }));
}

export async function extractBeersFromImage(url: string, pubName: string): Promise<FoundBeer[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  try {
    const res = await fetch(url, { headers: { "User-Agent": process.env.IMPORT_USER_AGENT ?? "DraftMapBot/0.1" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return [];
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024) return [];
    const { readBoard } = await import("../../src/lib/board-ocr");
    const reading = await readBoard({ bytes, mediaType: type }, { pubName });
    if (!reading.is_drinks_list) return [];
    return reading.beers.filter((b) => b.confidence >= 0.5).map((b) => ({ name: b.name, brewery: b.brewery, abv: b.abv, pricePence: b.price_pence, via: "image" as const, url, confidence: b.confidence }));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// 4. One pub, end to end
// ---------------------------------------------------------------------------

export async function researchPub(pub: { name: string; website?: string | null; city?: string | null; postcode?: string | null }): Promise<Research> {
  const notes: string[] = [];
  let website = cleanWebsite(pub.website);
  let websiteSource: Research["websiteSource"] = website ? "osm" : "none";
  if (!website) {
    website = await searchWebsite(pub);
    if (website) websiteSource = "search";
  }
  const empty: Research = { website, websiteSource, pagesFetched: 0, drinksPages: [], pdfs: [], imagesRead: 0, beers: [], evidence: "none", notes };
  if (!website) { notes.push("no website found"); return empty; }

  const crawl = await crawlForDrinks(website);
  const found = new Map<string, FoundBeer>();
  const add = (b: FoundBeer) => { const k = normaliseName(b.name); const cur = found.get(k); if (!cur || b.confidence > cur.confidence) found.set(k, b); };

  for (const p of crawl.drinksPages) {
    extractBeersFromText(p.text, p.url, "text").forEach(add);
    (await extractBeersWithClaude(p.text, p.url, pub.name)).forEach(add);
  }
  for (const pdf of crawl.pdfs) {
    const text = await pdfText(pdf);
    if (!text) continue;
    extractBeersFromText(text, pdf, "pdf").forEach(add);
    (await extractBeersWithClaude(text, pdf, pub.name)).forEach(add);
  }
  let imagesRead = 0;
  for (const img of crawl.images) {
    const beers = await extractBeersFromImage(img, pub.name);
    if (beers.length) imagesRead++;
    beers.forEach(add);
  }
  const beers = [...found.values()];
  if (!crawl.pages.length) notes.push("site unreachable or robots-blocked");
  else if (!crawl.drinksPages.length && !crawl.pdfs.length) notes.push("site has no drinks page");
  else if (!beers.length) notes.push("drinks page found but no beers recognised");
  if (crawl.embeds.includes("untappd")) notes.push("tap list is an Untappd embed (partner feed, not scrapable)");
  return { website, websiteSource, pagesFetched: crawl.pages.length, drinksPages: crawl.drinksPages.map((p) => p.url), pdfs: crawl.pdfs, imagesRead, beers, evidence: beers.length ? "site_menu" : "none", notes };
}
