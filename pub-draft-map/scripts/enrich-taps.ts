/**
 * Pre-fill tap lists for every pub in the database.
 *
 *   npm run enrich                       # all pubs, fetch OSM tags via Overpass
 *   npm run enrich -- --city manchester  # one area
 *   npm run enrich -- --tags tags.json   # reuse a saved Overpass dump (see fetch step)
 *   npm run enrich -- --dry              # report only
 *
 * Steps:
 *  1. Pull brand / operator / brewery / image / wikimedia_commons tags for our
 *     pubs from Overpass (by OSM id), and store brand/operator/image on Pub.
 *  2. Infer a "likely on tap" list per pub from data/brand-ranges.json and the
 *     OSM brewery tag (src/lib/enrich.ts), upserting TapListings with
 *     source=inferred|osm and a confidence. Never touches listings a person
 *     has added or confirmed (source user/pub_owner/partner).
 *  3. Removes inferred listings that no longer follow from the range (e.g. the
 *     pub changed operator) so the inference stays consistent.
 *
 * Sources: © OpenStreetMap contributors (ODbL); Wikimedia Commons images carry
 * their own licence, recorded in Pub.imageCredit.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { UK_PLACES, bboxAround } from "../src/lib/geo";
import { commonsThumb, inferTaps, loadBrandRanges, normaliseName } from "../src/lib/enrich";

const db = new PrismaClient();
const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

type Tags = Record<string, string>;
type OsmEl = { type: "node" | "way" | "relation"; id: number; tags?: Tags };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  return { city: get("city"), tags: get("tags"), dry: a.includes("--dry"), save: get("save") };
}

async function fetchTags(osmIds: string[]): Promise<Map<string, Tags>> {
  const out = new Map<string, Tags>();
  const nodes = osmIds.filter((i) => i.startsWith("node/")).map((i) => i.slice(5));
  const ways = osmIds.filter((i) => i.startsWith("way/")).map((i) => i.slice(4));
  const chunks = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const batches = [...chunks(nodes, 400).map((c) => `node(id:${c.join(",")});`), ...chunks(ways, 400).map((c) => `way(id:${c.join(",")});`)];
  for (const [i, body] of batches.entries()) {
    const q = `[out:json][timeout:120];(${body});out tags;`;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "draft-map-enrich (dev)" } });
      if (res.ok) {
        const json = (await res.json()) as { elements: OsmEl[] };
        for (const el of json.elements) out.set(`${el.type}/${el.id}`, el.tags ?? {});
        console.log(`tags batch ${i + 1}/${batches.length}: ${json.elements.length} elements`);
        break;
      }
      console.warn(`Overpass ${res.status}, retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 10_000 * attempt));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return out;
}

async function main() {
  const a = args();
  const ranges = loadBrandRanges();

  const where = a.city
    ? (() => { const c = UK_PLACES[a.city.toLowerCase()]; if (!c) throw new Error(`Unknown city ${a.city}`); const b = bboxAround(c, 15); return { lat: { gte: b.south, lte: b.north }, lng: { gte: b.west, lte: b.east } }; })()
    : {};
  const pubs = await db.pub.findMany({ where, select: { id: true, osmId: true, name: true, kind: true, brand: true, operator: true, imageUrl: true } });
  console.log(`${pubs.length} pubs`);

  // 1. OSM tags
  let tags: Map<string, Tags>;
  if (a.tags) {
    tags = new Map(Object.entries(JSON.parse(readFileSync(a.tags, "utf8")) as Record<string, Tags>));
  } else {
    tags = await fetchTags(pubs.map((p) => p.osmId).filter((x): x is string => Boolean(x)));
    if (a.save) writeFileSync(a.save, JSON.stringify(Object.fromEntries(tags)));
  }

  // 2. Beer catalogue for everything the ranges can produce
  const beerIds = new Map<string, string>();
  async function beerId(name: string, brewery: string, style: string | null, abv: number | null) {
    const key = normaliseName(name) + "|" + normaliseName(brewery);
    const hit = beerIds.get(key);
    if (hit) return hit;
    const b = await db.brewery.upsert({ where: { name: brewery }, update: {}, create: { name: brewery } });
    const beer = await db.beer.upsert({
      where: { name_breweryId: { name, breweryId: b.id } },
      update: { style: style ?? undefined, abv: abv ?? undefined },
      create: { name, breweryId: b.id, style, abv },
    });
    beerIds.set(key, beer.id);
    return beer.id;
  }

  let updatedPubs = 0, added = 0, removed = 0, withRange = 0;
  const byRange = new Map<string, number>();
  for (const p of pubs) {
    const t = (p.osmId && tags.get(p.osmId)) || {};
    const brand = t.brand ?? p.brand ?? null;
    const operator = t.operator ?? p.operator ?? null;
    let imageUrl = p.imageUrl ?? null, imageCredit: string | null = null;
    if (!imageUrl && t.wikimedia_commons?.startsWith("File:")) { imageUrl = commonsThumb(t.wikimedia_commons); imageCredit = `Wikimedia Commons, ${t.wikimedia_commons}`; }
    else if (!imageUrl && t.image?.startsWith("http")) { imageUrl = t.image; imageCredit = "OpenStreetMap image tag"; }

    const inferred = inferTaps({ name: p.name, kind: p.kind, brand, operator, breweryTag: t.brewery }, ranges);
    const rangeName = inferred.find((i) => i.source === "inferred")?.inferredFrom;
    if (rangeName) { withRange++; byRange.set(rangeName, (byRange.get(rangeName) ?? 0) + 1); }

    if (a.dry) continue;

    if (brand !== p.brand || operator !== p.operator || imageUrl !== p.imageUrl) {
      await db.pub.update({ where: { id: p.id }, data: { brand, operator, imageUrl, imageCredit: imageCredit ?? undefined, website: t.website ?? undefined, phone: t.phone ?? undefined } });
      updatedPubs++;
    }

    const existing = await db.tapListing.findMany({ where: { pubId: p.id }, include: { beer: { include: { brewery: true } } } });
    const wanted = new Map(inferred.map((i) => [normaliseName(i.beer), i]));
    for (const e of existing) {
      const key = normaliseName(e.beer.name);
      if (["inferred", "osm"].includes(e.source) && !wanted.has(key) && e.status === "ACTIVE") {
        await db.tapListing.update({ where: { id: e.id }, data: { status: "REMOVED", removedAt: new Date() } });
        removed++;
      }
      wanted.delete(key); // already present in some form: leave human-sourced rows alone
    }
    for (const i of wanted.values()) {
      const bid = await beerId(i.beer, i.brewery, i.style, i.abv);
      await db.tapListing.upsert({
        where: { pubId_beerId: { pubId: p.id, beerId: bid } },
        update: { status: "ACTIVE", removedAt: null, source: i.source, confidence: i.confidence, inferredFrom: i.inferredFrom },
        create: { pubId: p.id, beerId: bid, source: i.source, confidence: i.confidence, inferredFrom: i.inferredFrom, confirmations: 0 },
      });
      added++;
    }
  }

  console.log(`pubs with a matched range: ${withRange}/${pubs.length}`);
  console.log([...byRange.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `  ${v.toString().padStart(6)}  ${k}`).join("\n"));
  if (!a.dry) console.log(`updated ${updatedPubs} pubs, added/refreshed ${added} listings, removed ${removed} stale inferred listings`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
