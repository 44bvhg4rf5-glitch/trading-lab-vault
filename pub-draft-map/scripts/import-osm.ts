/**
 * Import every pub and bar in a bounding box from OpenStreetMap via Overpass.
 *
 *   npm run import:osm -- --bbox 53.40,-2.35,53.55,-2.10        # Manchester
 *   npm run import:osm -- --city manchester --radius 15
 *   npm run import:osm -- --uk                                   # whole UK, tiled (slow: ~1h)
 *
 * OSM has ~45k amenity=pub/bar nodes+ways in the UK. Overpass rate-limits, so
 * the --uk mode walks a 1°×1° grid with a pause between tiles and is resumable
 * (already-imported osmIds are upserted, so re-running is safe).
 *
 * Attribution: © OpenStreetMap contributors, ODbL. Keep this on the About page.
 */
import { PrismaClient } from "@prisma/client";
import { UK_BBOX, UK_PLACES, bboxAround, type BBox } from "../src/lib/geo";

const db = new PrismaClient();
const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return { bbox: get("bbox"), city: get("city"), radius: Number(get("radius") ?? 10), uk: a.includes("--uk") };
}

async function fetchTile(b: BBox): Promise<OsmElement[]> {
  const q = `
    [out:json][timeout:180];
    (
      node["amenity"~"^(pub|bar|biergarten)$"](${b.south},${b.west},${b.north},${b.east});
      way["amenity"~"^(pub|bar|biergarten)$"](${b.south},${b.west},${b.north},${b.east});
      node["craft"="brewery"]["microbrewery"="yes"](${b.south},${b.west},${b.north},${b.east});
    );
    out center tags;`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(OVERPASS, {
      method: "POST",
      body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "draft-map-import (github.com/draft-map)" },
    });
    if (res.ok) return ((await res.json()) as { elements: OsmElement[] }).elements;
    if (res.status === 429 || res.status === 504) {
      const wait = 15_000 * attempt;
      console.warn(`Overpass ${res.status}; waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  }
  throw new Error("Overpass gave up");
}

function kindOf(tags: Record<string, string>) {
  if (tags.craft === "brewery" || tags.microbrewery === "yes") return "brewery_tap";
  return tags.amenity === "bar" ? "bar" : "pub";
}

async function importTile(b: BBox) {
  const elements = await fetchTile(b);
  let n = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    if (lat == null || lng == null || !tags.name) continue;
    await db.pub.upsert({
      where: { osmId: `${el.type}/${el.id}` },
      update: {
        name: tags.name,
        kind: kindOf(tags),
        lat,
        lng,
        street: joinAddr(tags),
        city: tags["addr:city"] ?? tags["addr:town"] ?? null,
        postcode: tags["addr:postcode"] ?? null,
        website: tags.website ?? tags["contact:website"] ?? null,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
      },
      create: {
        osmId: `${el.type}/${el.id}`,
        name: tags.name,
        kind: kindOf(tags),
        lat,
        lng,
        street: joinAddr(tags),
        city: tags["addr:city"] ?? tags["addr:town"] ?? null,
        postcode: tags["addr:postcode"] ?? null,
        website: tags.website ?? tags["contact:website"] ?? null,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        source: "osm",
      },
    });
    n++;
  }
  return n;
}

function joinAddr(t: Record<string, string>) {
  const s = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return s || null;
}

async function main() {
  const a = args();
  let tiles: BBox[] = [];
  if (a.uk) {
    for (let lat = Math.floor(UK_BBOX.south); lat < UK_BBOX.north; lat++)
      for (let lng = Math.floor(UK_BBOX.west); lng < UK_BBOX.east; lng++)
        tiles.push({ south: lat, west: lng, north: lat + 1, east: lng + 1 });
  } else if (a.bbox) {
    const [south, west, north, east] = a.bbox.split(",").map(Number);
    tiles = [{ south, west, north, east }];
  } else if (a.city) {
    const c = UK_PLACES[a.city.toLowerCase()];
    if (!c) throw new Error(`Unknown city ${a.city}; use --bbox`);
    tiles = [bboxAround(c, a.radius)];
  } else {
    throw new Error("Pass --bbox, --city or --uk");
  }

  let total = 0;
  for (const [i, t] of tiles.entries()) {
    const n = await importTile(t);
    total += n;
    console.log(`tile ${i + 1}/${tiles.length} → ${n} venues (total ${total})`);
    if (tiles.length > 1) await new Promise((r) => setTimeout(r, 8_000));
  }
  console.log(`Done. ${total} venues upserted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
