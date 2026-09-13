/**
 * Shared plumbing for pub-company menu importers.
 *
 * Every importer:
 *  - identifies itself with a contact address in the User-Agent
 *  - checks robots.txt before every host and never fetches a disallowed path
 *  - fetches one page at a time with a polite delay, and caches responses on
 *    disk so re-runs and debugging don't hit the site again
 *  - stores only facts: pub identity, beer names, prices. No copy, no images.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const UA = process.env.IMPORT_USER_AGENT ?? "DraftMapBot/0.1 (+https://draftmap.example/bot; contact: hello@draftmap.example)";
const CACHE_DIR = process.env.IMPORT_CACHE_DIR ?? path.join(process.cwd(), ".cache", "importers");
const DELAY_MS = Number(process.env.IMPORT_DELAY_MS ?? 1500);

type Robots = { disallow: string[]; allow: string[]; crawlDelay?: number };
const robotsCache = new Map<string, Robots>();

async function robotsFor(origin: string): Promise<Robots> {
  const hit = robotsCache.get(origin);
  if (hit) return hit;
  const rules: Robots = { disallow: [], allow: [] };
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA } });
    if (res.ok) {
      let applies = false;
      for (const raw of (await res.text()).split("\n")) {
        const line = raw.replace(/#.*/, "").trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const [, key, val] = [m[0], m[1].toLowerCase(), m[2].trim()];
        if (key === "user-agent") applies = val === "*" || UA.toLowerCase().includes(val.toLowerCase());
        else if (applies && key === "disallow" && val) rules.disallow.push(val);
        else if (applies && key === "allow" && val) rules.allow.push(val);
        else if (applies && key === "crawl-delay") rules.crawlDelay = Number(val);
      }
    }
  } catch { /* no robots = allowed */ }
  robotsCache.set(origin, rules);
  return rules;
}

function matches(rule: string, pathname: string) {
  const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
  return re.test(pathname);
}

export async function allowed(url: string): Promise<boolean> {
  const u = new URL(url);
  const r = await robotsFor(u.origin);
  const p = u.pathname + u.search;
  const dis = r.disallow.filter((d) => matches(d, p)).sort((a, b) => b.length - a.length)[0];
  const al = r.allow.filter((d) => matches(d, p)).sort((a, b) => b.length - a.length)[0];
  if (!dis) return true;
  return Boolean(al && al.length >= dis.length);
}

let lastFetch = 0;
/** Polite fetch: robots-checked, throttled, disk-cached. Returns null when disallowed. */
export async function politeFetch(url: string, opts: { ttlHours?: number; json?: boolean } = {}): Promise<string | null> {
  if (!(await allowed(url))) { console.warn(`robots.txt disallows ${url}`); return null; }
  mkdirSync(CACHE_DIR, { recursive: true });
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE_DIR, key + (opts.json ? ".json" : ".html"));
  const ttl = (opts.ttlHours ?? 24 * 7) * 3600_000;
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < ttl) return readFileSync(file, "utf8");
  const u = new URL(url);
  const delay = Math.max(DELAY_MS, ((await robotsFor(u.origin)).crawlDelay ?? 0) * 1000);
  const wait = lastFetch + delay - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: opts.json ? "application/json" : "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      // DNS failure, blocked host, timeout: the importer keeps going without this page.
      console.warn(`unreachable ${url}: ${(e as Error).message}`);
      return null;
    }
    if (res.ok) { const body = await res.text(); writeFileSync(file, body); return body; }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 10_000 * attempt)); continue; }
    console.warn(`${res.status} ${url}`);
    return null;
  }
  return null;
}

export function stripTags(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** What every adapter hands back: one record per pub, beer names as written on the site. */
export type MenuRecord = {
  source: string; // "wetherspoon"
  externalId: string; // site's own id or slug
  name: string;
  postcode?: string | null;
  lat?: number | null;
  lng?: number | null;
  url: string;
  beers: { name: string; brewery?: string | null; abv?: number | null; pricePence?: number | null; category?: string | null }[];
};

export interface Adapter {
  key: string;
  /** Enumerate every pub on the site (cheap: sitemap or list endpoint). */
  list(): Promise<{ externalId: string; url: string; name?: string }[]>;
  /** Fetch one pub's drinks and return a record, or null if none published. */
  menu(entry: { externalId: string; url: string; name?: string }): Promise<MenuRecord | null>;
}
