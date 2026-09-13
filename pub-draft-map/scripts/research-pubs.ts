/**
 * Research every pub: find its website, read its drinks pages, PDFs and board
 * photos, write what's on draught, and delist pubs with no real evidence.
 *
 *   npm run research                          # every pub not yet researched
 *   npm run research -- --city harefield      # one area
 *   npm run research -- --limit 200 --dry     # report only
 *   npm run research -- --again               # re-research pubs done > 30 days ago
 *
 * Evidence ladder written to Pub.evidence:
 *   site_menu  beers read from the pub's own site       → listed, source=site:own
 *   company    pub-company importer already covered it  → listed
 *   chain      chain / tied range from OSM brand/operator→ listed
 *   people     a person published the list              → listed
 *   none       nothing anywhere                         → hidden=true, off the app
 *
 * Cost and speed: about 3-6 polite requests per pub (1.5 s apart, cached), so
 * ~50k pubs is a few days on one machine. Run several `--shard i/n` processes
 * in parallel: each takes a disjoint slice of pubs and they never hit the same
 * site at the same time because a pub belongs to one shard.
 * With ANTHROPIC_API_KEY set, drinks pages are also read by Claude (roughly
 * one request per drinks page found; the catalogue matcher runs regardless).
 */
import { PrismaClient } from "@prisma/client";
import { UK_PLACES, bboxAround } from "../src/lib/geo";
import { upsertBeer } from "../src/lib/beers";
import { researchPub } from "./research/lib";

const db = new PrismaClient();

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const shard = (get("shard") ?? "0/1").split("/").map(Number);
  return { city: get("city"), limit: Number(get("limit") ?? 0), dry: a.includes("--dry"), again: a.includes("--again"), shard: { i: shard[0] || 0, n: shard[1] || 1 } };
}

function hashShard(id: string, n: number) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

async function main() {
  const a = args();
  const since = new Date(Date.now() - 30 * 86400_000);
  const where = {
    ...(a.again ? { OR: [{ researchedAt: null }, { researchedAt: { lt: since } }] } : { researchedAt: null }),
    ...(a.city ? (() => { const c = UK_PLACES[a.city.toLowerCase()]; if (!c) throw new Error(`Unknown city ${a.city}`); const b = bboxAround(c, 15); return { lat: { gte: b.south, lte: b.north }, lng: { gte: b.west, lte: b.east } }; })() : {}),
  };
  const all = await db.pub.findMany({ where, select: { id: true, name: true, website: true, city: true, postcode: true, brand: true, operator: true, claimedById: true }, orderBy: { id: "asc" } });
  const pubs = all.filter((p) => hashShard(p.id, a.shard.n) === a.shard.i).slice(0, a.limit || undefined);
  console.log(`${pubs.length} pubs to research (shard ${a.shard.i}/${a.shard.n})`);

  const tally = { site_menu: 0, company: 0, chain: 0, people: 0, none: 0 };
  let listings = 0;
  for (const [i, p] of pubs.entries()) {
    const r = await researchPub(p);

    // What else already backs this pub?
    const existing = await db.tapListing.findMany({ where: { pubId: p.id, status: "ACTIVE" }, select: { source: true, inferredFrom: true } });
    const hasPeople = existing.some((t) => ["user", "pub_owner", "partner"].includes(t.source)) || Boolean(p.claimedById);
    const hasCompany = existing.some((t) => t.source.startsWith("site:") && t.source !== "site:own");
    const hasChain = existing.some((t) => ["inferred", "osm"].includes(t.source) && t.inferredFrom && t.inferredFrom !== "UK default pub");
    const evidence: keyof typeof tally = r.beers.length ? "site_menu" : hasPeople ? "people" : hasCompany ? "company" : hasChain ? "chain" : "none";
    tally[evidence]++;

    if (a.dry) {
      console.log(`${p.name.padEnd(32)} ${evidence.padEnd(10)} ${r.website ?? "-"}  ${r.beers.map((b) => b.name).join(", ")}  ${r.notes.join("; ")}`);
      continue;
    }

    for (const b of r.beers) {
      const beer = await upsertBeer({ name: b.name, breweryName: b.brewery ?? "Unknown brewery", abv: b.abv ?? undefined });
      await db.tapListing.upsert({
        where: { pubId_beerId: { pubId: p.id, beerId: beer.id } },
        update: { status: "ACTIVE", removedAt: null, lastSeenAt: new Date(), pricePence: b.pricePence ?? undefined },
        create: { pubId: p.id, beerId: beer.id, source: "site:own", confidence: Math.max(0.8, b.confidence), inferredFrom: b.url, pricePence: b.pricePence, confirmations: 0 },
      });
      // Upgrade any inferred row for the same beer to site evidence.
      await db.tapListing.updateMany({ where: { pubId: p.id, beerId: beer.id, source: { in: ["inferred", "osm"] } }, data: { source: "site:own", confidence: Math.max(0.8, b.confidence), inferredFrom: b.url } });
      listings++;
    }
    if (r.beers.length) {
      // The pub's own menu beats the national default guess.
      await db.tapListing.updateMany({ where: { pubId: p.id, status: "ACTIVE", source: "inferred", inferredFrom: "UK default pub" }, data: { status: "REMOVED", removedAt: new Date() } });
    }
    await db.pub.update({
      where: { id: p.id },
      data: { evidence, researchedAt: new Date(), hidden: evidence === "none", website: r.website ?? p.website ?? undefined },
    });
    if (i % 25 === 0) console.log(`${i}/${pubs.length}`, tally, `listings ${listings}`);
  }
  console.log("done", tally, `listings ${listings}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
