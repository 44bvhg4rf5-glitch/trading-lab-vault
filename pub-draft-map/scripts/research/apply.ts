/**
 * Write one pub's research result to the database. Shared by the automated
 * pipeline (research-pubs.ts) and the agent-research import (research-apply.ts)
 * so both follow the same evidence ladder and never overwrite a person's list.
 */
import type { PrismaClient } from "@prisma/client";
import { upsertBeer } from "../../src/lib/beers";

export type Evidence = "site_menu" | "company" | "chain" | "people" | "none";

export type ResearchBeer = {
  name: string;
  brewery?: string | null;
  style?: string | null;
  abv?: number | null;
  pricePence?: number | null;
  /** page the beer was read from */
  url?: string | null;
  confidence?: number;
};

export type PubForApply = { id: string; website: string | null; claimedById: string | null };

/** Nothing a drinks page calls "4.5%" is a beer just because it has a percentage after it. */
export const JUNK_BEER = /^(belgium|belgian|cambridgeshire|cornwall|cornish|cotswolds?|czech|ireland|irish|italy|italian|mexico|mexican|spain|spanish|suffolk|sweden|swedish|yorkshire|germany|german|england|english|scotland|scottish|wales|welsh|london|kent|devon|somerset|france|french|usa|american|holland|dutch|japan|japanese|vegetarian( vegan)?|vegan|cherries|cherry|lime|lemon|passionfruit|strawberry|raspberry|mango|peach|alcopops.*|hooch.*|vk .*|wkd.*|smirnoff.*|prosecco|champagne|pinot .*|picpoul.*|veuve .*|sauvignon.*|merlot|malbec|rioja|chardonnay|shiraz|rose|rosé|red wine|white wine|house .*|game day .*|tavern game .*|draught|draft|cask|keg|lager|ale|beer|cider|ipa|stout|pale ale|bitter|pilsner|pint|half|pints|spirits|cocktails|wine|wines|gin|vodka|rum|whisky)$/i;

export async function applyPubResearch(
  db: PrismaClient,
  pub: PubForApply,
  r: { website: string | null; beers: ResearchBeer[]; sourceLabel?: string },
): Promise<{ evidence: Evidence; listings: number }> {
  const beers = r.beers.filter((b) => b.name && !JUNK_BEER.test(b.name.trim()));
  const source = r.sourceLabel ?? "site:own";

  // What else already backs this pub?
  const existing = await db.tapListing.findMany({ where: { pubId: pub.id, status: "ACTIVE" }, select: { source: true, inferredFrom: true } });
  const hasPeople = existing.some((t) => ["user", "pub_owner", "partner"].includes(t.source)) || Boolean(pub.claimedById);
  const hasCompany = existing.some((t) => t.source.startsWith("site:") && t.source !== "site:own");
  const hasChain = existing.some((t) => ["inferred", "osm"].includes(t.source) && t.inferredFrom && t.inferredFrom !== "UK default pub");
  const evidence: Evidence = beers.length ? "site_menu" : hasPeople ? "people" : hasCompany ? "company" : hasChain ? "chain" : "none";

  let listings = 0;
  for (const b of beers) {
    const beer = await upsertBeer({ name: b.name.trim(), breweryName: b.brewery?.trim() || "Unknown brewery", abv: b.abv ?? undefined, style: b.style ?? undefined });
    const confidence = Math.max(0.8, b.confidence ?? 0.9);
    const inferredFrom = b.url ?? r.website ?? undefined;
    await db.tapListing.upsert({
      where: { pubId_beerId: { pubId: pub.id, beerId: beer.id } },
      update: { status: "ACTIVE", removedAt: null, lastSeenAt: new Date(), pricePence: b.pricePence ?? undefined },
      create: { pubId: pub.id, beerId: beer.id, source, confidence, inferredFrom, pricePence: b.pricePence ?? null, confirmations: 0 },
    });
    // Upgrade any inferred row for the same beer to site evidence.
    await db.tapListing.updateMany({ where: { pubId: pub.id, beerId: beer.id, source: { in: ["inferred", "osm"] } }, data: { source, confidence, inferredFrom } });
    listings++;
  }
  if (beers.length) {
    // The pub's own menu beats the national default guess.
    await db.tapListing.updateMany({ where: { pubId: pub.id, status: "ACTIVE", source: "inferred", inferredFrom: "UK default pub" }, data: { status: "REMOVED", removedAt: new Date() } });
  }
  await db.pub.update({
    where: { id: pub.id },
    data: { evidence, researchedAt: new Date(), hidden: evidence === "none", website: r.website ?? pub.website ?? undefined },
  });
  return { evidence, listings };
}

/** Retire site-read listings whose "beer" is a country, a fruit, a wine or a category word. */
export async function retireJunkListings(db: PrismaClient): Promise<number> {
  const rows = await db.tapListing.findMany({ where: { status: "ACTIVE", source: { startsWith: "site:" } }, select: { id: true, beer: { select: { name: true } } } });
  const junk = rows.filter((t) => JUNK_BEER.test(t.beer.name.trim()) || /\n/.test(t.beer.name)).map((t) => t.id);
  if (junk.length) await db.tapListing.updateMany({ where: { id: { in: junk } }, data: { status: "REMOVED", removedAt: new Date() } });
  return junk.length;
}
