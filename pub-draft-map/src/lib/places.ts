import { readFileSync } from "node:fs";
import path from "node:path";
import { damerauLevenshtein } from "./beers";
import type { LatLng } from "./geo";

/**
 * UK gazetteer: every populated place in GeoNames GB (~43k cities, towns,
 * villages, districts). Loaded once per process from data/gb-places.txt.
 * Format per line: name|lat|lng|rank|nearest-big-place
 *
 * Attribution: GeoNames, CC BY 4.0 (https://www.geonames.org).
 */
export type Place = LatLng & { name: string; rank: number; ctx: string; key: string };

const RANK_LABEL = ["Capital", "City", "City", "Town", "Town", "Town or village", "District", "Locality", "Place"];

let cache: Place[] | null = null;

function load(): Place[] {
  if (cache) return cache;
  const file = path.join(process.cwd(), "data", "gb-places.txt");
  cache = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, lat, lng, rank, ctx] = line.split("|");
      return { name, lat: Number(lat), lng: Number(lng), rank: Number(rank), ctx, key: normalise(name) };
    });
  return cache;
}

export function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function placeLabel(p: Place) {
  return p.ctx && p.ctx !== p.name ? `${p.name}, near ${p.ctx}` : p.name;
}

export function placeKind(p: Place) {
  return RANK_LABEL[p.rank] ?? "Place";
}

/** Exact → prefix → fuzzy, each ordered by importance. */
export function findPlaces(q: string, limit = 7): Place[] {
  const t = normalise(q);
  if (t.length < 2) return [];
  const tol = t.length <= 4 ? 1 : 2;
  const exact: Place[] = [], prefix: Place[] = [], fuzzy: Place[] = [];
  for (const p of load()) {
    if (p.key === t) exact.push(p);
    else if (p.key.startsWith(t)) prefix.push(p);
    else if (t.length >= 4 && p.key.includes(" ") && p.key.split(" ").includes(t)) prefix.push(p);
    else if (t.length >= 4 && Math.abs(p.key.length - t.length) <= tol && damerauLevenshtein(t, p.key) <= tol) fuzzy.push(p);
  }
  const byRank = (a: Place, b: Place) => a.rank - b.rank;
  return [...exact.sort(byRank), ...prefix.sort(byRank), ...fuzzy.sort(byRank)].slice(0, limit);
}
