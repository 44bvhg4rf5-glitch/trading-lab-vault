/**
 * Research packets: one JSON file per pub with the text that matters from the
 * pub's own website (drinks page excerpts, PDF text, board photos on disk).
 * Built by research-packets.ts for a whole area and by research-worker.ts when
 * a worker finds a website mid-run. Fetching is polite (robots.txt, throttle,
 * cache) and identical for every worker, whichever AI reads the packet.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allowed, UA } from "../importers/lib";
import { crawlForDrinks, pdfText } from "./lib";

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

export const PUB_SELECT = { id: true, osmId: true, name: true, street: true, city: true, postcode: true, lat: true, lng: true, brand: true, operator: true, website: true } as const;

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
  return packet;
}

/** Where a pub's packet lives: its area directory if the shard file knows it, else "adhoc". */
export function packetPath(root: string, shards: { shard: string; pubIds: string[] }[], pubId: string) {
  const s = shards.find((x) => x.pubIds.includes(pubId))?.shard ?? "adhoc";
  const dir = path.join(root, "packets", s);
  mkdirSync(dir, { recursive: true });
  return { dir, file: path.join(dir, `${pubId}.json`), imgDir: path.join(dir, "img") };
}
