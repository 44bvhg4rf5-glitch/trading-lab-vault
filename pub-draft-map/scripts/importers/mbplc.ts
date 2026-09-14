/**
 * Mitchells & Butlers brands — All Bar One, O'Neill's, Nicholson's, Toby
 * Carvery, Harvester, Browns, Ember Inns, Vintage Inns, Miller & Carter,
 * Sizzling Pubs (~1,150 venues with a drinks page).
 *
 * Verified September 2026:
 *  - Every brand site publishes a per-venue drinks page (URL shapes differ
 *    per brand, listed below) and a sitemap that includes it.
 *  - The drinks page embeds a <mab-menu id="<tradingEntityId>"
 *    id-type="TradingEntity" page-path="drinks-menu1"> element; the menu
 *    itself comes from an open JSON API:
 *      https://api-production.mbplc.io/webappbff/api/v1/menus/dynamic
 *        ?id=<tradingEntityId>&idType=TradingEntity
 *        &salesChannel=DynamicWebMenus&websitePageUrlPath=<page-path>
 *    with sections → subSections → menuItems {guestFacingName, abv, portions[{price}]}.
 *  - The venue page carries schema.org JSON-LD with postcode and coordinates.
 *
 * What the menus actually contain: bottles and cans for most brands. The
 * draught range is only published where a section is called On Tap / Draught /
 * Keg / Cask (All Bar One does this). We import ONLY those sections; a bottle
 * list is not a tap list. Brands whose drinks page is a landing page with no
 * menu component (Ember Inns, Vintage Inns, Miller & Carter at the time of
 * writing) return no record.
 */
import { politeFetch, type Adapter, type MenuRecord } from "./lib";

const API = "https://api-production.mbplc.io/webappbff/api/v1/menus/dynamic";

type Brand = { key: string; host: string; drinkPage: RegExp };

/** Per-brand venue drink-page shapes (from each sitemap). */
export const MB_BRANDS: Brand[] = [
  { key: "allbarone", host: "https://www.allbarone.co.uk", drinkPage: /^https:\/\/www\.allbarone\.co\.uk\/national-search\/[^/]+\/[^/]+\/drink$/ },
  { key: "oneills", host: "https://www.oneills.co.uk", drinkPage: /^https:\/\/www\.oneills\.co\.uk\/national-search\/[^/]+\/[^/]+\/drink$/ },
  { key: "nicholsons", host: "https://www.nicholsonspubs.co.uk", drinkPage: /^https:\/\/www\.nicholsonspubs\.co\.uk\/restaurants\/[^/]+\/[^/]+\/drinks$/ },
  { key: "tobycarvery", host: "https://www.tobycarvery.co.uk", drinkPage: /^https:\/\/www\.tobycarvery\.co\.uk\/restaurants\/[^/]+\/[^/]+\/drinks$/ },
  { key: "harvester", host: "https://www.harvester.co.uk", drinkPage: /^https:\/\/www\.harvester\.co\.uk\/restaurants\/[^/]+\/[^/]+\/menus\/drinks$/ },
  { key: "browns", host: "https://www.browns-restaurants.co.uk", drinkPage: /^https:\/\/www\.browns-restaurants\.co\.uk\/restaurants\/[^/]+\/[^/]+\/menus\/drinks-menu$/ },
  { key: "emberinns", host: "https://www.emberinns.co.uk", drinkPage: /^https:\/\/www\.emberinns\.co\.uk\/nationalsearch\/[^/]+\/[^/]+\/menus\/drink$/ },
  { key: "vintageinn", host: "https://www.vintageinn.co.uk", drinkPage: /^https:\/\/www\.vintageinn\.co\.uk\/restaurants\/[^/]+\/[^/]+\/drink$/ },
  { key: "millerandcarter", host: "https://www.millerandcarter.co.uk", drinkPage: /^https:\/\/www\.millerandcarter\.co\.uk\/restaurants\/[^/]+\/[^/]+\/menus\/drinksmenu$/ },
  { key: "sizzlingpubs", host: "https://www.sizzlingpubs.co.uk", drinkPage: /^https:\/\/www\.sizzlingpubs\.co\.uk\/findapub\/[^/]+\/[^/]+\/drink$/ },
];

const TAP_SECTION = /\b(on tap|on draught|draught|draft|keg|cask|hand ?pull|pumps?)\b/i;
const NOT_TAP = /\b(bottle|bottled|bottles|cans?|low\s*&?\s*no|alcohol[- ]free|0\.0%?)\b/i;

type Item = { guestFacingName?: string; name?: string; abv?: string | number; portions?: { price?: number }[] };
type Section = { name: string; menuItems?: Item[]; subSections?: Section[] };

export function tapBeers(menu: { sections?: Section[] }): MenuRecord["beers"] {
  const out = new Map<string, MenuRecord["beers"][number]>();
  const take = (items: Item[], trail: string[]) => {
    for (const it of items) {
      const raw = (it.guestFacingName ?? it.name ?? "").trim();
      if (!raw || NOT_TAP.test(raw) || /\b\d{3}ml\b/i.test(raw)) continue; // "330ml" is a bottle even in a tap section
      const name = raw.replace(/\s*\(VE?\)\s*/gi, " ").replace(/\b(keg|draught|draft|lager|stout|cider)\b\s*$/i, "").replace(/\s{2,}/g, " ").trim();
      const abv = it.abv != null ? parseFloat(String(it.abv)) : NaN;
      const price = it.portions?.[0]?.price;
      if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { name, abv: Number.isFinite(abv) ? abv : null, pricePence: typeof price === "number" ? Math.round(price * 100) : null, category: trail.at(-1) ?? null });
    }
  };
  const walk = (s: Section, trail: string[]) => {
    const t = [...trail, s.name];
    if (TAP_SECTION.test(s.name) && !NOT_TAP.test(s.name) && s.menuItems?.length) take(s.menuItems, t);
    for (const sub of s.subSections ?? []) walk(sub, t);
  };
  for (const s of menu.sections ?? []) walk(s, []);
  return [...out.values()];
}

/** The venue's schema.org block (LocalBusiness / Restaurant / BarOrPub) from the page's ld+json scripts. */
function venueLd(html: string): { name?: string; address?: { postalCode?: string }; geo?: { latitude?: number | string; longitude?: number | string } } | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]) as Record<string, unknown> | Record<string, unknown>[];
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && typeof node === "object" && "address" in node && "name" in node) return node as ReturnType<typeof venueLd>;
      }
    } catch { /* not this one */ }
  }
  return null;
}
function ldNumber(html: string, key: string) {
  const v = html.match(new RegExp(`"${key}"\\s*:\\s*"?(-?\\d+\\.\\d+)"?`))?.[1];
  return v ? Number(v) : null;
}

export function mbBrand(brand: Brand): Adapter {
  return {
    key: brand.key,

    async list() {
      const xml = await politeFetch(`${brand.host}/sitemap.xml`, { ttlHours: 24 });
      if (!xml) return [];
      const out: { externalId: string; url: string }[] = [];
      const seen = new Set<string>();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const url = m[1];
        if (!brand.drinkPage.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ externalId: url.replace(brand.host, "").replace(/\/(menus\/)?drinks?(-menu|menu)?$/, ""), url });
      }
      return out;
    },

    async menu(entry) {
      const html = await politeFetch(entry.url);
      if (!html) return null;
      const tag = html.match(/<mab-menu\b[^>]*>/)?.[0];
      const tradingEntityId = tag?.match(/\bid="(\d+)"/)?.[1];
      const pagePath = tag?.match(/\bpage-path="([^"]+)"/)?.[1];
      if (!tradingEntityId || !pagePath) return null; // landing page, no menu component
      const venueUrl = brand.host + entry.externalId;
      const venueHtml = (await politeFetch(venueUrl)) ?? html;
      const ld = venueLd(venueHtml) ?? venueLd(html);
      const record: MenuRecord = {
        source: brand.key,
        externalId: tradingEntityId,
        name: (ld?.name ?? venueHtml.match(/<title>([^<|–-]*)/)?.[1]?.trim() ?? entry.externalId.split("/").pop() ?? entry.externalId).replace(/&#39;|&apos;|\\u0027/g, "'").replace(/&amp;/g, "&").trim(),
        postcode: ld?.address?.postalCode ?? venueHtml.match(/Postcode:\s*"([^"]+)"/)?.[1] ?? null,
        lat: ld?.geo?.latitude != null ? Number(ld.geo.latitude) : ldNumber(venueHtml, "latitude"),
        lng: ld?.geo?.longitude != null ? Number(ld.geo.longitude) : ldNumber(venueHtml, "longitude"),
        url: entry.url,
        beers: [],
      };
      const q = new URLSearchParams({ id: tradingEntityId, idType: "TradingEntity", salesChannel: "DynamicWebMenus", websitePageUrlPath: pagePath });
      const json = await politeFetch(`${API}?${q}`, { json: true, ttlHours: 48 });
      if (!json) return record;
      try { record.beers = tapBeers(JSON.parse(json)); } catch (e) { console.warn(`${record.name}: menu parse failed: ${(e as Error).message}`); }
      return record;
    },
  };
}

export const mbAdapters: Record<string, Adapter> = Object.fromEntries(MB_BRANDS.map((b) => [b.key, mbBrand(b)]));
