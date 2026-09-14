/**
 * Import what the AI research workers found (see research-packets.ts).
 *
 *   npx tsx scripts/research-apply.ts                 # every .cache/research/results/*.json
 *   npx tsx scripts/research-apply.ts --dir <dir>     # another results folder
 *   npx tsx scripts/research-apply.ts --dry           # report only
 *
 * Each results file is a JSON array of:
 *   { pubId, website, evidence: "site_menu" | "none", beers: [{ name, brewery, style, abv, pricePence, url }], notes: [] }
 * Beers go in as source "site:own" (the pub's own published list); a pub with
 * none stays hidden. Also retires earlier site-read listings whose name is a
 * country, a fruit or a wine, which the keyless text matcher used to produce.
 */
import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { applyPubResearch, retireJunkListings } from "./research/apply";

const db = new PrismaClient();

const Result = z.object({
  pubId: z.string(),
  website: z.string().url().nullable().optional(),
  evidence: z.enum(["site_menu", "none"]),
  beers: z.array(z.object({
    name: z.string().min(2),
    brewery: z.string().nullable().optional(),
    style: z.string().nullable().optional(),
    abv: z.number().min(0).max(20).nullable().optional(),
    pricePence: z.number().int().min(100).max(2000).nullable().optional(),
    url: z.string().nullable().optional(),
  })).default([]),
  notes: z.array(z.string()).default([]),
});

async function main() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const dir = get("dir") ?? path.join(process.cwd(), ".cache", "research", "results");
  const dry = a.includes("--dry");

  const results = new Map<string, z.infer<typeof Result>>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let rows: unknown;
    try { rows = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch (e) { console.warn(`${f}: unreadable (${(e as Error).message})`); continue; }
    if (!Array.isArray(rows)) { console.warn(`${f}: not an array`); continue; }
    for (const [i, row] of rows.entries()) {
      const parsed = Result.safeParse(row);
      if (!parsed.success) { console.warn(`${f}[${i}]: ${parsed.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")}`); continue; }
      results.set(parsed.data.pubId, parsed.data); // last write wins
    }
  }
  console.log(`${results.size} pub results in ${dir}`);

  const tally = { site_menu: 0, company: 0, chain: 0, people: 0, none: 0 };
  let listings = 0, missing = 0;
  for (const r of results.values()) {
    const pub = await db.pub.findUnique({ where: { id: r.pubId }, select: { id: true, name: true, website: true, claimedById: true } });
    if (!pub) { missing++; continue; }
    const beers = r.evidence === "site_menu" ? r.beers : [];
    if (dry) { console.log(`${pub.name.padEnd(32)} ${r.evidence.padEnd(10)} ${r.website ?? "-"}  ${beers.map((b) => b.name).join(", ")}`); continue; }
    const out = await applyPubResearch(db, pub, { website: r.website ?? null, beers: beers.map((b) => ({ ...b, confidence: 0.9 })) });
    tally[out.evidence]++;
    listings += out.listings;
  }
  if (!dry) {
    const junk = await retireJunkListings(db);
    console.log("applied", tally, `listings ${listings}, unknown pubs ${missing}, junk listings retired ${junk}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
