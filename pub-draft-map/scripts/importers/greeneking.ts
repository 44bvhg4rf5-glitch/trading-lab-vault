/**
 * Greene King managed pubs (greeneking.co.uk) — 753 pubs.
 *
 * Verified September 2026:
 *  - robots.txt allows pub pages; sitemap.xml lists every pub as
 *    /pubs/<county>/<slug>, plus /our-beers and /menu under each.
 *  - The pub page carries schema.org LocalBusiness JSON-LD inside the
 *    Sitecore JSS state: name, street, postcode, latitude/longitude, branchCode.
 *  - /our-beers is server-rendered: a PromoList ("We also do cask beer")
 *    naming the cask ales on at that pub (Greene King IPA, Abbot Ale and the
 *    current guest, Genevieve in September 2026). Checked across counties:
 *    the list is the same at every managed pub, so it is the company's core
 *    cask range published on each pub's page rather than a pub-by-pub list.
 *    Still worth importing (it is the company saying what that pub pours),
 *    and the adapter will pick up any pub whose list starts to differ.
 *  - /menu loads the full drinks list from prod-mobile-bff.greeneking.co.uk,
 *    which sits behind Akamai bot protection and refuses non-browser clients.
 *    We do not work around that: the keg range comes from the brand range
 *    (data/brand-ranges.json) until Greene King offers a feed.
 *
 * Hungry Horse, Chef & Brewer, Flaming Grill and Farmhouse Inns run on the
 * same platform but have no /our-beers page, so they are not covered here.
 */
import { politeFetch, type Adapter, type MenuRecord } from "./lib";

const SITE = "https://www.greeneking.co.uk";

type Jss = { sitecore?: { context?: { venueName?: string; venueId?: string; venueLocation?: string }; route?: { placeholders?: Record<string, unknown[]> } } };

function jssState(html: string): Jss | null {
  const m = html.match(/<script type="application\/json" id="__JSS_STATE__">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]) as Jss; } catch { return null; }
}

/** schema.org LocalBusiness block embedded (as an escaped string) in the page state. */
function localBusiness(html: string) {
  const grab = (key: string) => html.match(new RegExp(`\\\\"${key}\\\\":\\s*\\\\"([^\\\\]*)\\\\"`))?.[1] ?? null;
  return { postcode: grab("postalCode"), lat: grab("latitude"), lng: grab("longitude"), street: grab("streetAddress"), branch: grab("branchCode") };
}

/** Every PromoListItem title under a PromoList whose heading mentions beer, ale or cask. */
function promoBeers(state: Jss): string[] {
  const out: string[] = [];
  const walk = (node: unknown, underBeerList: boolean) => {
    if (Array.isArray(node)) { node.forEach((n) => walk(n, underBeerList)); return; }
    if (!node || typeof node !== "object") return;
    const c = node as { componentName?: string; fields?: Record<string, { value?: unknown }>; placeholders?: Record<string, unknown[]> };
    let inList = underBeerList;
    if (c.componentName === "PromoList") {
      const heading = String(c.fields?.heading?.value ?? "");
      inList = /\b(beer|beers|ale|ales|cask|tap|taps|brew)\b/i.test(heading);
    }
    if (c.componentName === "PromoListItem" && inList) {
      const title = String(c.fields?.title?.value ?? "").trim();
      if (title) out.push(title);
    }
    for (const ph of Object.values(c.placeholders ?? {})) walk(ph, inList);
  };
  walk(Object.values(state.sitecore?.route?.placeholders ?? {}), false);
  return out;
}

const GK_BREWED = /^(greene king|abbot|old speckled hen|ice breaker|level head|hazy day|flint eye|belhaven|yardbird|ruddles|olde trip|morland|london glory|east coast|fresh start|ipa|brewer|tolly)/i;

export const greeneking: Adapter = {
  key: "greeneking",

  async list() {
    const xml = await politeFetch(`${SITE}/sitemap.xml`, { ttlHours: 24 });
    if (!xml) return [];
    const seen = new Set<string>();
    const out: { externalId: string; url: string }[] = [];
    for (const m of xml.matchAll(/<loc>\s*(https:\/\/www\.greeneking\.co\.uk\/pubs\/([a-z0-9-]+)\/([a-z0-9-]+))\s*<\/loc>/g)) {
      const id = `${m[2]}/${m[3]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ externalId: id, url: m[1] });
    }
    return out;
  },

  async menu(entry) {
    const html = await politeFetch(entry.url);
    if (!html) return null;
    const state = jssState(html);
    const lb = localBusiness(html);
    const name = state?.sitecore?.context?.venueName ?? html.match(/<title>([^<|]*)/)?.[1]?.trim() ?? entry.externalId;
    const record: MenuRecord = {
      source: "greeneking",
      externalId: lb.branch ?? state?.sitecore?.context?.venueId ?? entry.externalId,
      name: name.replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&"),
      postcode: lb.postcode,
      lat: lb.lat ? Number(lb.lat) : null,
      lng: lb.lng ? Number(lb.lng) : null,
      url: entry.url,
      beers: [],
    };
    const beersHtml = await politeFetch(`${entry.url}/our-beers`);
    const beersState = beersHtml ? jssState(beersHtml) : null;
    if (!beersState) return record;
    const seen = new Set<string>();
    for (const title of promoBeers(beersState)) {
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      record.beers.push({ name: title, brewery: GK_BREWED.test(title) || /greene king/i.test(title) ? "Greene King" : null, category: "cask" });
    }
    return record;
  },
};
