/**
 * Unattended research worker: one area, one search provider, one reader.
 * Implements docs/research-algorithm.md step by step, the same workflow the
 * Claude Code workers follow by hand, so results from any provider merge.
 *
 *   npm run research:worker -- --shard area-005 --search gemini --read gemini
 *   npm run research:worker -- --shard area-005 --search brave  --read openai
 *   npm run research:worker -- --shard area-005 --search none   --read anthropic
 *   npm run research:worker -- --shard area-005 --search none   --read none      # catalogue only, no keys
 *
 * Options: --root <dir> (default .cache/research), --limit N, --dry.
 * Resume-safe: pubs already in results/<shard>.json are skipped, and a record
 * is appended after every pub. Exit codes: 0 done, 3 provider allowance spent
 * (rerun later; it continues where it stopped), 1 error.
 *
 * Run one process per area. Never point two processes at the same shard.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JUNK_BEER } from "./research/apply";
import { cleanWebsite, extractBeersFromText, type FoundBeer } from "./research/lib";
import { buildPacket, packetPath, type Packet } from "./research/packet";
import { QuotaExhausted, READ, SEARCH } from "./research/providers";

type Index = { shard: string; label: string; pubs: { id: string; name: string; address: string; website: string | null; packet: string }[] };
type Result = { pubId: string; osmId: string | null; name: string; website: string | null; evidence: "site_menu" | "none"; beers: { name: string; brewery: string | null; style: string | null; abv: number | null; pricePence: number | null; url: string | null }[]; notes: string[]; worker: string; at: string };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const shard = get("shard");
  if (!shard) throw new Error("--shard <name> is required (see .cache/research/shards.json)");
  const search = get("search") ?? "none", read = get("read") ?? "none";
  if (!(search in SEARCH)) throw new Error(`--search must be one of ${Object.keys(SEARCH).join(", ")}`);
  if (!(read in READ)) throw new Error(`--read must be one of ${Object.keys(READ).join(", ")}`);
  return { shard, search, read, root: get("root") ?? path.join(process.cwd(), ".cache", "research"), limit: Number(get("limit") ?? 0), dry: a.includes("--dry") };
}

const SERVING_OK = new Set([null, "draught", "keg", "cask", "tap", "draft"]);

function fromReading(reading: { is_drinks_list: boolean; beers: { name: string; brewery: string | null; style: string | null; abv: number | null; price_pence: number | null; serving: string | null; confidence: number }[] }, url: string | null): Result["beers"] {
  if (!reading.is_drinks_list) return [];
  return reading.beers
    .filter((b) => b.confidence >= 0.5 && SERVING_OK.has(b.serving?.toLowerCase() ?? null) && !JUNK_BEER.test(b.name.trim()))
    .map((b) => ({ name: b.name.trim(), brewery: b.brewery, style: b.style, abv: b.abv, pricePence: b.price_pence, url }));
}

function fromCatalogue(packet: Packet): Result["beers"] {
  const found = new Map<string, FoundBeer>();
  for (const p of packet.drinksPages) for (const b of extractBeersFromText(p.excerpt, p.url, "text")) if (!found.has(b.name.toLowerCase())) found.set(b.name.toLowerCase(), b);
  for (const p of packet.pdfs) for (const b of extractBeersFromText(p.excerpt, p.url, "pdf")) if (!found.has(b.name.toLowerCase())) found.set(b.name.toLowerCase(), b);
  // Without a model only catalogue matches (confidence 0.85) count; the "<Name> 4.5%" guesses do not.
  return [...found.values()].filter((b) => b.confidence >= 0.8 && !JUNK_BEER.test(b.name)).map((b) => ({ name: b.name, brewery: b.brewery, style: null, abv: b.abv, pricePence: b.pricePence, url: b.url }));
}

async function main() {
  const a = args();
  const search = SEARCH[a.search], read = READ[a.read];
  const worker = `worker:${a.search}+${a.read}`;
  const index = JSON.parse(readFileSync(path.join(a.root, "packets", a.shard, "index.json"), "utf8")) as Index;
  const shards = existsSync(path.join(a.root, "shards.json")) ? (JSON.parse(readFileSync(path.join(a.root, "shards.json"), "utf8")) as { shard: string; pubIds: string[] }[]) : [];
  mkdirSync(path.join(a.root, "results"), { recursive: true });
  const resultsFile = path.join(a.root, "results", `${a.shard}.json`);
  const results: Result[] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : [];
  const done = new Set(results.map((r) => r.pubId));
  const todo = index.pubs.filter((p) => !done.has(p.id)).slice(0, a.limit || undefined);
  console.log(`${a.shard} (${index.label}): ${index.pubs.length} pubs, ${done.size} done, ${todo.length} to do, ${worker}`);

  const tally = { site_menu: 0, none: 0, searched: 0, found: 0, read: 0 };
  for (const [i, p] of todo.entries()) {
    let packet = JSON.parse(readFileSync(p.packet, "utf8")) as Packet;
    const notes: string[] = [];
    let website = cleanWebsite(packet.website);
    try {
      // Step 2: one search, only when nothing is on record.
      if (!website && search) {
        tally.searched++;
        website = await search({ name: packet.pub.name, city: packet.pub.city, postcode: packet.pub.postcode, street: packet.pub.street });
        if (website) {
          tally.found++;
          notes.push(`website found by ${a.search} search`);
          // Step 3: rebuild the packet from the found site, politely.
          const { file, imgDir } = packetPath(a.root, shards, packet.pub.id);
          packet = await buildPacket(packet.pub, website, imgDir);
          if (!a.dry) writeFileSync(file, JSON.stringify(packet, null, 2));
        } else notes.push(`no website on record; ${a.search} search found none`);
      } else if (!website) notes.push("no website on record; not searched");

      // Steps 4-5: read and decide.
      let beers: Result["beers"] = [];
      if (website) {
        notes.push(...packet.notes);
        const hasContent = packet.drinksPages.length || packet.pdfs.length || packet.images.length;
        const firstUrl = packet.drinksPages[0]?.url ?? packet.pdfs[0]?.url ?? website;
        if (hasContent && read) {
          tally.read++;
          const reading = await read(packet);
          if (reading) { beers = fromReading(reading, firstUrl); if (reading.notes) notes.push(reading.notes); }
          else notes.push("reader returned no usable JSON; fell back to catalogue matching");
          if (!reading) beers = fromCatalogue(packet);
        } else if (hasContent) beers = fromCatalogue(packet);
        if (hasContent && !beers.length) notes.push("drinks content found but no draught beer named");
      }
      const evidence = beers.length ? "site_menu" : "none";
      tally[evidence]++;
      const rec: Result = { pubId: p.id, osmId: packet.pub.osmId, name: packet.pub.name, website, evidence, beers, notes: [...new Set(notes)], worker, at: new Date().toISOString() };
      if (a.dry) console.log(`${packet.pub.name.padEnd(32)} ${evidence.padEnd(10)} ${website ?? "-"}  ${beers.map((b) => b.name).join(", ")}  ${rec.notes.join("; ")}`);
      else { results.push(rec); writeFileSync(resultsFile, JSON.stringify(results, null, 1)); }
    } catch (e) {
      if (e instanceof QuotaExhausted) {
        console.error(`\nAllowance spent after ${i} pubs (${e.message}). Rerun this command later; it resumes from the results file.`);
        console.log(tally);
        process.exit(3);
      }
      console.warn(`${packet.pub.name}: ${(e as Error).message.slice(0, 200)} (skipped, will retry on the next run)`);
    }
    if (i % 10 === 9) console.log(`${i + 1}/${todo.length}`, tally);
  }
  console.log("done", tally, a.dry ? "(dry run, nothing written)" : `→ ${resultsFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
