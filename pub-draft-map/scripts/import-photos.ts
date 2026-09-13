/**
 * Licensed exterior photos for pubs, from Wikimedia Commons.
 *
 *   npm run import:photos                      # every pub without a photo
 *   npm run import:photos -- --city richmond   # one area
 *   npm run import:photos -- --limit 500
 *
 * Commons hosts ~1.2 million Geograph photos of Britain (CC BY-SA 2.0) plus
 * Commons' own uploads, and nearly every pub in the country has been
 * photographed. We geosearch within 60 m of the pub, prefer files whose title
 * contains the pub's name, and store a 640px thumbnail URL plus the credit
 * string the licence requires. Rate: ~5 requests/second with a real
 * User-Agent, which is what the Wikimedia API etiquette asks for.
 */
import { PrismaClient } from "@prisma/client";
import { UK_PLACES, bboxAround } from "../src/lib/geo";
import { normaliseName } from "../src/lib/enrich";

const db = new PrismaClient();
const UA = process.env.GEOCODER_USER_AGENT ?? "draft-map-photos (contact: set GEOCODER_USER_AGENT)";
const API = "https://commons.wikimedia.org/w/api.php";

type Geo = { pageid: number; title: string; dist: number };
type ImageInfo = { pageid: number; title: string; imageinfo?: { thumburl?: string; extmetadata?: Record<string, { value: string }> }[] };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  return { city: get("city"), limit: Number(get("limit") ?? 0), force: a.includes("--force") };
}

async function api(params: Record<string, string>) {
  const url = new URL(API);
  Object.entries({ format: "json", ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  return res.json();
}

// Words that appear in pub names but say nothing about which pub: ignored when matching titles.
const STOP = new Set(["the", "inn", "pub", "hotel", "arms", "bar", "tavern", "and", "of", "house", "beer", "street", "road", "lane", "old", "new", "royal"]);
function nameTokens(name: string) {
  return normaliseName(name).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
}

/** Score a candidate file: whole-word name hits in the title beat distance. */
function score(title: string, dist: number, tokens: string[]) {
  const words = new Set(normaliseName(title).split(" "));
  const hits = tokens.filter((w) => words.has(w)).length;
  const pubWord = ["pub", "inn", "arms", "tavern", "hotel", "bar"].some((w) => words.has(w)) ? 1 : 0;
  return { hits, pubWord, s: hits * 10 + pubWord * 3 - dist / 20 };
}

export async function findPhoto(pub: { name: string; lat: number; lng: number }) {
  // Geograph photos are geotagged where the photographer stood, often 50-100 m from the pub, so search wide and rely on the name match.
  const geo = (await api({ action: "query", list: "geosearch", gscoord: `${pub.lat}|${pub.lng}`, gsradius: "150", gsnamespace: "6", gslimit: "50" })) as { query?: { geosearch: Geo[] } };
  const cands = (geo.query?.geosearch ?? []).filter((g) => /\.(jpe?g|png)$/i.test(g.title));
  if (!cands.length) return null;
  const tokens = nameTokens(pub.name);
  cands.sort((a, b) => score(b.title, b.dist, tokens).s - score(a.title, a.dist, tokens).s);
  const best = cands[0];
  // Require a name hit, or a pub-looking title within 15 m; otherwise we'd attach the pub's neighbour.
  const { hits, pubWord } = score(best.title, best.dist, tokens);
  if (hits === 0 && !(pubWord && best.dist < 15)) return null;
  const info = (await api({ action: "query", pageids: String(best.pageid), prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "640" })) as { query: { pages: Record<string, ImageInfo> } };
  const page = Object.values(info.query.pages)[0];
  const ii = page.imageinfo?.[0];
  if (!ii?.thumburl) return null;
  const meta = ii.extmetadata ?? {};
  const artist = (meta.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim();
  const licence = meta.LicenseShortName?.value ?? "see Commons";
  return { url: ii.thumburl, credit: `${artist || "Wikimedia Commons"} · ${licence} · ${page.title}` };
}

async function main() {
  const a = args();
  const where = {
    ...(a.force ? {} : { imageUrl: null }),
    ...(a.city ? (() => { const c = UK_PLACES[a.city.toLowerCase()]; if (!c) throw new Error(`Unknown city ${a.city}`); const b = bboxAround(c, 15); return { lat: { gte: b.south, lte: b.north }, lng: { gte: b.west, lte: b.east } }; })() : {}),
  };
  const pubs = await db.pub.findMany({ where, select: { id: true, name: true, lat: true, lng: true }, take: a.limit || undefined });
  console.log(`${pubs.length} pubs to photograph`);
  let found = 0;
  for (const [i, p] of pubs.entries()) {
    try {
      const photo = await findPhoto(p);
      if (photo) { await db.pub.update({ where: { id: p.id }, data: { imageUrl: photo.url, imageCredit: photo.credit } }); found++; }
    } catch (e) { console.warn(`${p.name}: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 5000)); }
    if (i % 100 === 0) console.log(`${i}/${pubs.length} · ${found} photos`);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`done: ${found}/${pubs.length} pubs got a photo`);
}

if (process.argv[1]?.endsWith("import-photos.ts")) main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
