/**
 * J D Wetherspoon — 827 pubs, all with a published drinks range.
 *
 * Verified from this repo's sandbox:
 *  - robots.txt allows everything; sitemap lists every pub
 *    (https://www.jdwetherspoon.com/pubs-sitemap.xml)
 *  - each pub page carries the postcode and a map snapshot URL with the
 *    pub's coordinates; the pub-menus page carries the venue id
 *    (allergen link ?pub_id=N and MENU_N.pdf)
 *  - that PDF is the FOOD table menu; drinks are not in it
 *  - the WordPress REST collection exists but its item and paging URLs
 *    redirect to the bare collection, so it is not used
 *
 * Drinks come from the same API the Wetherspoon app uses (the "Find an ale"
 * feature). That host was unreachable from the sandbox this was written in
 * (egress policy), so the request below is written from the app's known URL
 * shape and parsed defensively: run `--limit 3 --dry` locally first and, if
 * the shape differs, fix `parseMenu`. Everything else is verified.
 */
import { UA, politeFetch, stripTags, type Adapter, type MenuRecord } from "./lib";

const SITE = "https://www.jdwetherspoon.com";
const MENU_API = process.env.WETHERSPOON_MENU_API ?? "https://static.wsstack.nn4maws.net/v1/venues/en-gb/menus/v1";


const DRAUGHT_WORDS = /\b(ale|ales|lager|lagers|cider|ciders|draught|draft|cask|keg|stout|beer|beers|guest)\b/i;
const NOT_DRAUGHT = /\b(bottle|bottled|can|cans|wine|spirit|gin|vodka|whisky|rum|soft|coffee|tea|cocktail|alcohol[- ]free|0\.0%|shots?)\b/i;

export const wetherspoon: Adapter = {
  key: "wetherspoon",

  async list() {
    const xml = await politeFetch(`${SITE}/pubs-sitemap.xml`, { ttlHours: 24 });
    if (!xml) return [];
    return [...xml.matchAll(/<loc>(https:\/\/www\.jdwetherspoon\.com\/pubs\/([^/<]+)\/?)<\/loc>/g)].map((m) => ({ externalId: m[2], url: m[1] }));
  },

  async menu(entry) {
    // 1. Identity from the pub page: title, postcode, and the map snapshot's centre.
    //    (The site's REST item URLs redirect to the collection, so the HTML is the reliable source.)
    const html = await politeFetch(entry.url);
    if (!html) return null;
    const name = stripTags(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/\s*-\s*J ?D Wetherspoon.*$/i, "").trim() || entry.externalId;
    const postcode = html.match(/\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/)?.[1] ?? null;
    const centre = html.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const record: MenuRecord = {
      source: "wetherspoon",
      externalId: entry.externalId,
      name,
      postcode,
      lat: centre ? Number(centre[1]) : null,
      lng: centre ? Number(centre[2]) : null,
      url: entry.url,
      beers: [],
    };
    // 2. Venue id from the pub-menus page (allergen link / MENU_<id>.pdf).
    const menusHtml = await politeFetch(`${SITE}/pub-menus/${entry.externalId}/`);
    const venueId = menusHtml?.match(/pub_id=(\d+)/)?.[1] ?? menusHtml?.match(/MENU_(\d+)\.pdf/)?.[1];
    if (!venueId) return record;

    // 3. Drinks: app menu API (see header note).
    const menuJson = await politeFetch(`${MENU_API}/${venueId}.json`, { json: true, ttlHours: 48 });
    if (!menuJson) return record;
    try { record.beers = parseMenu(JSON.parse(menuJson)); } catch (e) { console.warn(`${record.name}: menu parse failed: ${(e as Error).message}`); }
    return record;
  },
};

/**
 * Walk any JSON shape looking for {name/productName, price/...} items that sit
 * under a category or section whose name says ale / lager / cider / draught.
 * Deliberately schema-agnostic so a field rename doesn't silently zero the import.
 */
export function parseMenu(root: unknown): MenuRecord["beers"] {
  const out = new Map<string, MenuRecord["beers"][number]>();
  const visit = (node: unknown, trail: string[]) => {
    if (Array.isArray(node)) { node.forEach((n) => visit(n, trail)); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const label = String(o.name ?? o.title ?? o.productName ?? o.displayName ?? "");
    const isLeaf = typeof (o.price ?? o.displayPrice ?? o.priceValue ?? o.pricePence) !== "undefined" || typeof o.productId !== "undefined";
    const sectionTrail = label && !isLeaf ? [...trail, label] : trail;
    if (isLeaf && label && sectionTrail.some((s) => DRAUGHT_WORDS.test(s)) && !NOT_DRAUGHT.test(label) && !sectionTrail.some((s) => NOT_DRAUGHT.test(s))) {
      const priceRaw = o.price ?? o.displayPrice ?? o.priceValue ?? o.pricePence;
      const pricePence = typeof priceRaw === "number" ? (priceRaw > 100 ? Math.round(priceRaw) : Math.round(priceRaw * 100)) : typeof priceRaw === "string" ? Math.round(parseFloat(priceRaw.replace(/[^\d.]/g, "")) * 100) || null : null;
      const abv = typeof o.abv === "number" ? o.abv : typeof o.abv === "string" ? parseFloat(o.abv) || null : null;
      const name = label.replace(/\s*\(?\d+(\.\d+)?%\)?\s*$/, "").trim();
      if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { name, brewery: typeof o.brewery === "string" ? o.brewery : null, abv, pricePence, category: sectionTrail.at(-1) ?? null });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") visit(v, sectionTrail);
  };
  visit(root, []);
  return [...out.values()];
}

// Keep UA referenced so the identifying header is obviously part of this adapter's contract.
void UA;
