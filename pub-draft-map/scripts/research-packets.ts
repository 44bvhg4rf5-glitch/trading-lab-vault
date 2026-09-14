/**
 * Research packets for AI workers.
 *
 * The automated pipeline (research-pubs.ts) can only read plain text. Instead
 * of paying for an API key, a group of AI workers (Claude Code subagents or
 * research-worker.ts on any provider's free tier, one per area) does the
 * reading: finding the pub's own website, reading its drinks pages, PDFs and
 * board photos, and writing a clean draught list.
 *
 * This script does the polite, robots-honouring fetching for them and writes
 * one JSON "packet" per pub with the text that matters, so a worker never
 * crawls a site itself and never sees more than a few thousand characters
 * per pub.
 *
 *   npx tsx scripts/research-packets.ts --hidden --shards 12
 *       every hidden pub, split into 12 geographic areas under .cache/research/
 *   npx tsx scripts/research-packets.ts --all --shards 300
 *       every pub not yet researched (a whole-country run: ~160 pubs an area)
 *   npx tsx scripts/research-packets.ts --pub <id> --website https://example.pub
 *       (re)build one packet with a website a worker found
 *
 * Workers write their findings to .cache/research/results/<shard>.json and
 * research-apply.ts writes them to the database. The workflow every worker
 * follows is docs/research-algorithm.md.
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanWebsite } from "./research/lib";
import { buildPacket, packetPath, PUB_SELECT, type PacketPub } from "./research/packet";

const db = new PrismaClient();

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  return { hidden: a.includes("--hidden"), all: a.includes("--all"), shards: Number(get("shards") ?? 12), pub: get("pub"), website: get("website"), out: get("out") ?? path.join(process.cwd(), ".cache", "research"), limit: Number(get("limit") ?? 0) };
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
      out.push({ shard: `area-${String(out.length + 1).padStart(3, "0")}`, label, pubs: cell });
    }
  }
  return out;
}

async function main() {
  const a = args();
  mkdirSync(path.join(a.out, "results"), { recursive: true });

  if (a.pub) {
    // One pub, with a website a worker found: rebuild its packet in place.
    const pub = await db.pub.findUnique({ where: { id: a.pub }, select: PUB_SELECT });
    if (!pub) throw new Error(`no pub ${a.pub}`);
    const website = cleanWebsite(a.website ?? pub.website);
    if (!website) throw new Error(`no usable website (social and aggregator hosts are rejected)`);
    const shardsFile = path.join(a.out, "shards.json");
    const shards = existsSync(shardsFile) ? (JSON.parse(readFileSync(shardsFile, "utf8")) as { shard: string; pubIds: string[] }[]) : [];
    const { file, imgDir } = packetPath(a.out, shards, pub.id);
    const packet = await buildPacket(pub, website, imgDir);
    writeFileSync(file, JSON.stringify(packet, null, 2));
    console.log(JSON.stringify({ file, website, pagesFetched: packet.pagesFetched, drinksPages: packet.drinksPages.length, pdfs: packet.pdfs.length, images: packet.images.length, notes: packet.notes }));
    return;
  }

  const where = a.hidden ? { hidden: true } : a.all ? { researchedAt: null } : {};
  const pubs = await db.pub.findMany({ where, select: PUB_SELECT, orderBy: { id: "asc" }, take: a.limit || undefined });
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
