import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Turns what we know about a pub (OSM brand/operator/brewery tags, its name)
 * into a list of beers that are probably on its bar, before anyone has been
 * in to check. See docs/data-sourcing.md, "Layer D: inference".
 */

export type BeerSpec = { brewery: string; style: string | null; abv: number | null };
export type Range = {
  match: string[];
  /** Also match against the pub's name (chains whose brand is on the sign). Default: tags only. */
  nameMatch?: boolean;
  confidence: number;
  note?: string;
  beers: string[];
};
export type BrandRanges = { beers: Record<string, BeerSpec>; ranges: Record<string, Range> };

export type InferredTap = {
  beer: string;
  brewery: string;
  style: string | null;
  abv: number | null;
  source: "osm" | "inferred";
  confidence: number;
  inferredFrom: string;
};

let cache: BrandRanges | null = null;
export function loadBrandRanges(): BrandRanges {
  if (cache) return cache;
  cache = JSON.parse(readFileSync(path.join(process.cwd(), "data", "brand-ranges.json"), "utf8")) as BrandRanges;
  return cache;
}

export function normaliseName(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which range (if any) applies to this pub. Brand tag beats operator tag beats
 * the pub's name; the name is only consulted for ranges with nameMatch, so
 * "The Punch Bowl" doesn't become a Punch Taverns pub.
 */
export function matchRange(pub: { name: string; brand?: string | null; operator?: string | null; kind?: string }, ranges = loadBrandRanges()): { name: string; range: Range } | null {
  const candidates: Array<[string, boolean]> = [
    ...[pub.brand, pub.operator].filter((s): s is string => Boolean(s)).map((s) => [normaliseName(s), false] as [string, boolean]),
    [normaliseName(pub.name), true],
  ];
  for (const [c, isName] of candidates) {
    for (const [name, range] of Object.entries(ranges.ranges)) {
      if (!range.match.length) continue;
      if (isName && !range.nameMatch) continue;
      for (const m of range.match) {
        const key = normaliseName(m);
        // Whole-phrase match, so "lees" doesn't fire on "fleece" and "punch" doesn't fire on "punchbowl".
        if (c === key || c.startsWith(key + " ") || c.endsWith(" " + key) || c.includes(" " + key + " ")) return { name, range };
      }
    }
  }
  if (pub.kind !== "bar" && ranges.ranges["UK default pub"]) return { name: "UK default pub", range: ranges.ranges["UK default pub"] };
  return null;
}

/**
 * OSM `brewery=*` lists beers or breweries served, semicolon separated:
 * "Fuller's;Guinness;Sharp's Doom Bar". We keep each token as a beer name when
 * it is one we know, otherwise as a brewery with a generic listing.
 */
export function parseOsmBrewery(tag: string | undefined | null, ranges = loadBrandRanges()): InferredTap[] {
  if (!tag) return [];
  const known = new Map(Object.entries(ranges.beers).map(([name, spec]) => [normaliseName(name), { name, spec }]));
  // Brewery name → its flagship (first beer listed for that brewery), so "Fuller's" → London Pride.
  const flagship = new Map<string, { name: string; spec: BeerSpec }>();
  for (const [name, spec] of Object.entries(ranges.beers)) {
    const b = normaliseName(spec.brewery.replace(/\s*\(.*\)$/, ""));
    if (!flagship.has(b)) flagship.set(b, { name, spec });
  }
  const out: InferredTap[] = [];
  for (const raw of tag.split(/;|,/)) {
    const token = raw.trim();
    if (!token || /^(yes|no|various|guest|rotating)$/i.test(token)) continue;
    const key = normaliseName(token);
    const hit =
      known.get(key) ??
      flagship.get(key) ??
      [...known.values()].find((k) => normaliseName(k.name) === key || (key.length >= 6 && normaliseName(k.name).includes(key)));
    if (hit) out.push({ beer: hit.name, brewery: hit.spec.brewery, style: hit.spec.style, abv: hit.spec.abv, source: "osm", confidence: 0.85, inferredFrom: "OpenStreetMap brewery tag" });
    else out.push({ beer: token, brewery: token, style: null, abv: null, source: "osm", confidence: 0.7, inferredFrom: "OpenStreetMap brewery tag" });
  }
  return out;
}

/** Full inference for one pub: OSM brewery tag first (higher trust), then the brand range. */
export function inferTaps(pub: { name: string; kind?: string; brand?: string | null; operator?: string | null; breweryTag?: string | null }, ranges = loadBrandRanges()): InferredTap[] {
  const seen = new Set<string>();
  const out: InferredTap[] = [];
  for (const t of parseOsmBrewery(pub.breweryTag, ranges)) {
    if (!seen.has(normaliseName(t.beer))) { seen.add(normaliseName(t.beer)); out.push(t); }
  }
  const m = matchRange(pub, ranges);
  if (m) {
    for (const beer of m.range.beers) {
      if (seen.has(normaliseName(beer))) continue;
      const spec = ranges.beers[beer];
      seen.add(normaliseName(beer));
      out.push({ beer, brewery: spec.brewery, style: spec.style, abv: spec.abv, source: "inferred", confidence: m.range.confidence, inferredFrom: m.name });
    }
  }
  return out;
}

/** Wikimedia Commons file title → a thumbnail URL we can hot-link (Commons allows it). */
export function commonsThumb(fileTitle: string, width = 640) {
  const title = fileTitle.replace(/^File:/i, "").replace(/ /g, "_");
  return `https://commons.wikimedia.org/w/thumb.php?f=${encodeURIComponent(title)}&w=${width}`;
}
