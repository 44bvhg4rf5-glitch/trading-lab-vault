/**
 * Research packets for AI workers.
 *
 * The automated pipeline (research-pubs.ts) can only read plain text. Instead
 * of paying for an API key, a group of AI agents (Claude Code subagents, one
 * per area) does the reading: finding the pub's own website, reading its
 * drinks pages, PDFs and board photos, and writing a clean draught list.
 *
 * This script does the polite, robots-honouring fetching for them and writes
 * one JSON "packet" per pub with the text that matters, so a worker never
 * crawls a site itself and never sees more than a few thousand characters
 * per pub.
 *
 *   npx tsx scripts/research-packets.ts --hidden --shards 12
 *       every hidden pub, split into 12 geographic areas under .cache/research/
 *   npx tsx scripts/research-packets.ts --pub <id> --website https://example.pub
 *       (re)build one packet with a website a worker found
 *
 * Workers write their findings to .cache/research/results/<shard>.json and
 * research-apply.ts writes them to the database.
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allowed, UA } from "./importers/lib";
import { cleanWebsite, crawlForDrinks, pdfText } from "./research/lib";

const db = new PrismaClient();

export type PacketPub = { id: string; osmId: string | null; name: string; street: string | null; city: string | null; postcode: string | null; lat: number; lng: number; brand: string | null; operator: string | null; website: string | null };
export type Packet = {
  pub: PacketPub;
  website: string | null;
  pagesFetched: number;
  drinksPages: { url: string; excerpt: string }[];
  pdfs: { url: string; excerpt: string }[];
  images: { url: string; file: string }[];
  embeds: string[];
  notes: string[];
};

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  return { hidden: a.includes("--hidden"), shards: Number(get("shards") ?? 12), pub: get("pub"), website: get("website"), out: get("out") ?? path.join(process.cwd(), ".cache", "research"), limit: Number(get("limit") ?? 0) };
}

const DRINK_WORDS = /on tap|on draught|on draft|draught|draft|cask|keg|real ale|craft|guest|lager|ale\b|cider|stout|ipa\b|pale|pilsner|pint|beer/gi;

/** The parts of a long page a reader needs: windows around drink words, merged, capped. */
export function excerpt(text: string, cap = 6000): string {
  if (text.length <= cap) return text;
  const spans: [number, number][] = [];
  for (const m of text.matchAll(DRINK_WORDS)) {
    const s = Math.max(0, m.index! - 500), e = Math.min(text.length, m.index! + 900);
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else spans.push([s, e]);
  }
  let out = "";
  for (const [s, e] of spans) {
    if (out.length + (e - s) > cap) { out += text.slice(s, s + Math.max(0, cap - out.length)); break; }
    out += (out ? " … " : "") + text.slice(s, e);
  }
  return out || text.slice(0, cap);
}

async function saveImage(url: string, file: string): Promise<boolean> {
  try {
    if (existsSync(file)) return true;
    if (!(await allowed(url))) return false;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024 || bytes.byteLength < 5_000) return false;
    writeFileSync(file, bytes);
    return true;
  } catch { return false; }
}

export async function buildPacket(pub: PacketPub, website: string | null, imgDir: string): Promise<Packet> {
  const packet: Packet = { pub, website, pagesFetched: 0, drinksPages: [], pdfs: [], images: [], embeds: [], notes: [] };
  if (!website) { packet.notes.push("no website on record: search for the pub's own site"); return packet; }
  const crawl = await crawlForDrinks(website);
  packet.pagesFetched = crawl.pages.length;
  packet.drinksPages = crawl.drinksPages.map((p) => ({ url: p.url, excerpt: excerpt(p.text) }));
  for (const url of crawl.pdfs) {
    const text = await pdfText(url);
    if (text) packet.pdfs.push({ url, excerpt: excerpt(text, 8000) });
  }
  mkdirSync(imgDir, { recursive: true });
  for (const [i, url] of crawl.images.entries()) {
    const ext = (url.match(/\.(jpe?g|png|webp)/i)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
    const file = path.join(imgDir, `${pub.id}-${i}.${ext}`);
    if (await saveImage(url, file)) packet.images.push({ url, file });
  }
  packet.embeds = crawl.embeds;
  if (!crawl.pages.length) packet.notes.push("site unreachable or robots-blocked");
  else if (!crawl.drinksPages.length && !crawl.pdfs.length) packet.notes.push("no page on the site mentions drinks; the crawl may have missed one");
  if (crawl.embeds.includes("untappd")) packet.notes.push("tap list is an Untappd embed (not readable here)");
  // Untappd embed pages: a fetchable menu page sometimes sits at the pub's own /menu URL even so.
  return packet;
}

/** Split pubs into roughly square geographic areas of similar size. */
function shard(pubs: PacketPub[], n: number): { shard: string; label: string; pubs: PacketPub[] }[] {
  const cols = Math.max(1, Math.round(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const byLng = [...pubs].sort((a, b) => a.lng - b.lng);
  const out: { shard: string; label: string; pubs: PacketPub[] }[] = [];
  for (let c = 0; c < cols; c++) {
    const col = byLng.slice(Math.floor((c * byLng.length) / cols), Math.floor(((c + 1) * byLng.length) / cols)).sort((a, b) => a.lat - b.lat);
    for (let r = 0; r < rows; r++) {
      const cell = col.slice(Math.floor((r * col.length) / rows), Math.floor(((r + 1) * col.length) / rows));
      if (!cell.length) continue;
      const cities = new Map<string, number>();
      for (const p of cell) { const k = p.city ?? p.postcode?.split(" ")[0] ?? "?"; cities.set(k, (cities.get(k) ?? 0) + 1); }
      const label = [...cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(" / ");
      out.push({ shard: `area-${String(out.length + 1).padStart(2, "0")}`, label, pubs: cell });
    }
  }
  return out;
}

const SELECT = { id: true, osmId: true, name: true, street: true, city: true, postcode: true, lat: true, lng: true, brand: true, operator: true, website: true } as const;

async function main() {
  const a = args();
  mkdirSync(path.join(a.out, "results"), { recursive: true });

  if (a.pub) {
    // One pub, with a website a worker found: rebuild its packet in place.
    const pub = await db.pub.findUnique({ where: { id: a.pub }, select: SELECT });
    if (!pub) throw new Error(`no pub ${a.pub}`);
    const website = cleanWebsite(a.website ?? pub.website);
    if (!website) throw new Error(`no usable website (social and aggregator hosts are rejected)`);
    const shards = JSON.parse(readFileSync(path.join(a.out, "shards.json"), "utf8")) as { shard: string; pubIds: string[] }[];
    const s = shards.find((x) => x.pubIds.includes(pub.id))?.shard ?? "adhoc";
    const dir = path.join(a.out, "packets", s);
    mkdirSync(dir, { recursive: true });
    const packet = await buildPacket(pub, website, path.join(dir, "img"));
    const file = path.join(dir, `${pub.id}.json`);
    writeFileSync(file, JSON.stringify(packet, null, 2));
    console.log(JSON.stringify({ file, website, pagesFetched: packet.pagesFetched, drinksPages: packet.drinksPages.length, pdfs: packet.pdfs.length, images: packet.images.length, notes: packet.notes }));
    return;
  }

  const pubs = await db.pub.findMany({ where: a.hidden ? { hidden: true } : {}, select: SELECT, orderBy: { id: "asc" }, take: a.limit || undefined });
  const shards = shard(pubs, a.shards);
  writeFileSync(path.join(a.out, "shards.json"), JSON.stringify(shards.map((s) => ({ shard: s.shard, label: s.label, count: s.pubs.length, withWebsite: s.pubs.filter((p) => cleanWebsite(p.website)).length, dir: path.join(a.out, "packets", s.shard), pubIds: s.pubs.map((p) => p.id) })), null, 2));
  console.log(`${pubs.length} pubs in ${shards.length} areas`);

  for (const s of shards) {
    const dir = path.join(a.out, "packets", s.shard);
    mkdirSync(dir, { recursive: true });
    const index: { id: string; name: string; address: string; website: string | null; packet: string }[] = [];
    for (const p of s.pubs) {
      const website = cleanWebsite(p.website);
      const file = path.join(dir, `${p.id}.json`);
      if (!existsSync(file)) {
        const packet = await buildPacket(p, website, path.join(dir, "img"));
        writeFileSync(file, JSON.stringify(packet, null, 2));
      }
      index.push({ id: p.id, name: p.name, address: [p.street, p.city, p.postcode].filter(Boolean).join(", "), website, packet: file });
    }
    writeFileSync(path.join(dir, "index.json"), JSON.stringify({ shard: s.shard, label: s.label, pubs: index }, null, 2));
    console.log(`${s.shard} ${s.label}: ${s.pubs.length} pubs, ${index.filter((i) => i.website).length} with a website`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
