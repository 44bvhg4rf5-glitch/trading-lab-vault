/**
 * Import drinks menus published by pub companies on their own websites.
 *
 *   npm run import:menus -- --site wetherspoon
 *   npm run import:menus -- --site wetherspoon --limit 20 --dry
 *   npm run import:menus -- --site greeneking --filter "middlesex|greater-london"
 *   sites: wetherspoon, greeneking, allbarone, oneills, nicholsons, tobycarvery,
 *          harvester, browns, emberinns, vintageinn, millerandcarter, sizzlingpubs
 *
 * One adapter per site (scripts/importers/<site>.ts). Every adapter goes
 * through politeFetch(): robots.txt honoured, throttled, cached, identified
 * with a contact address. Records are matched to our Pub rows by postcode +
 * name, falling back to name + distance, and the beers become TapListings with
 * source="site:<key>" and confidence 0.95. A human confirmation still wins.
 *
 * Facts only: beer names and prices. No menu copy, no images.
 */
import { PrismaClient } from "@prisma/client";
import { haversineKm } from "../src/lib/geo";
import { normaliseName } from "../src/lib/enrich";
import { upsertBeer } from "../src/lib/beers";
import type { Adapter, MenuRecord } from "./importers/lib";
import { wetherspoon } from "./importers/wetherspoon";
import { greeneking } from "./importers/greeneking";
import { mbAdapters } from "./importers/mbplc";

const db = new PrismaClient();
const ADAPTERS: Record<string, Adapter> = { wetherspoon, greeneking, ...mbAdapters };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  return { site: get("site"), limit: Number(get("limit") ?? 0), dry: a.includes("--dry"), filter: get("filter") ? new RegExp(get("filter")!, "i") : null };
}

const normPostcode = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, "");

/** Find our Pub for a site record: postcode + similar name, else name within 300 m. */
async function matchPub(rec: MenuRecord) {
  const tokens = normaliseName(rec.name).split(" ").filter((w) => w.length > 2 && !["the", "inn", "pub", "hotel"].includes(w));
  const similar = (name: string) => { const n = normaliseName(name); return tokens.filter((t) => n.includes(t)).length >= Math.max(1, Math.ceil(tokens.length / 2)); };
  if (rec.postcode) {
    const byPc = await db.pub.findMany({ where: { postcode: { not: null } }, select: { id: true, name: true, postcode: true, lat: true, lng: true }, take: 0 }).catch(() => []);
    void byPc;
    const rows = await db.$queryRaw<{ id: string; name: string; lat: number; lng: number }[]>`SELECT id, name, lat, lng FROM "Pub" WHERE upper(replace(postcode, ' ', '')) = ${normPostcode(rec.postcode)}`;
    const hit = rows.find((r) => similar(r.name)) ?? (rows.length === 1 ? rows[0] : undefined);
    if (hit) return hit;
  }
  if (rec.lat != null && rec.lng != null) {
    const d = 0.004;
    const rows = await db.pub.findMany({ where: { lat: { gte: rec.lat - d, lte: rec.lat + d }, lng: { gte: rec.lng - d * 1.6, lte: rec.lng + d * 1.6 } }, select: { id: true, name: true, lat: true, lng: true } });
    const near = rows.filter((r) => similar(r.name)).sort((a, b) => haversineKm(a, rec as { lat: number; lng: number }) - haversineKm(b, rec as { lat: number; lng: number }));
    if (near[0] && haversineKm(near[0], rec as { lat: number; lng: number }) < 0.3) return near[0];
  }
  return null;
}

async function main() {
  const a = args();
  const adapter = a.site ? ADAPTERS[a.site] : undefined;
  if (!adapter) throw new Error(`--site must be one of: ${Object.keys(ADAPTERS).join(", ")}`);

  const all = await adapter.list();
  // --filter <regex> limits the run to matching venue URLs (e.g. a county) when the database only covers one area.
  const entries = a.filter ? all.filter((e) => a.filter!.test(e.url)) : all;
  console.log(`${adapter.key}: ${all.length} venues listed${a.filter ? `, ${entries.length} match --filter` : ""}`);
  let matched = 0, unmatched = 0, listings = 0, noMenu = 0;
  const unmatchedNames: string[] = [];
  for (const [i, entry] of (a.limit ? entries.slice(0, a.limit) : entries).entries()) {
    const rec = await adapter.menu(entry);
    if (!rec || !rec.beers.length) { noMenu++; continue; }
    const pub = await matchPub(rec);
    if (!pub) { unmatched++; unmatchedNames.push(`${rec.name} ${rec.postcode ?? ""}`); continue; }
    matched++;
    if (a.dry) { console.log(`${rec.name} → ${pub.name}: ${rec.beers.map((b) => b.name).join(", ")}`); continue; }
    const source = `site:${adapter.key}`;
    const keep = new Set<string>();
    for (const b of rec.beers) {
      const beer = await upsertBeer({ name: b.name, breweryName: b.brewery ?? "Unknown brewery", abv: b.abv ?? undefined });
      keep.add(beer.id);
      await db.tapListing.upsert({
        where: { pubId_beerId: { pubId: pub.id, beerId: beer.id } },
        // Never downgrade a human-confirmed row; refresh everything else.
        update: { status: "ACTIVE", removedAt: null, lastSeenAt: new Date(), pricePence: b.pricePence ?? undefined },
        create: { pubId: pub.id, beerId: beer.id, source, confidence: 0.95, inferredFrom: rec.url, pricePence: b.pricePence ?? null, confirmations: 0 },
      });
      await db.tapListing.updateMany({ where: { pubId: pub.id, beerId: beer.id, source: { in: ["inferred", "osm"] } }, data: { source, confidence: 0.95, inferredFrom: rec.url } });
      listings++;
    }
    // The site's menu is authoritative for that site's own pubs: retire inferred rows it doesn't list.
    await db.tapListing.updateMany({ where: { pubId: pub.id, status: "ACTIVE", source: { in: ["inferred", "osm", source] }, beerId: { notIn: [...keep] } }, data: { status: "REMOVED", removedAt: new Date() } });
    if (i % 25 === 0) console.log(`${i}/${entries.length} · matched ${matched} · unmatched ${unmatched} · listings ${listings}`);
  }
  console.log(`done. matched ${matched}, unmatched ${unmatched}, no menu ${noMenu}, listings ${listings}`);
  if (unmatchedNames.length) console.log("unmatched (first 20):\n  " + unmatchedNames.slice(0, 20).join("\n  "));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
