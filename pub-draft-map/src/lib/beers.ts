import { db } from "./db";

/**
 * Beer name matching. Users type "asahi", "Asahi Super Dry", "ashai" (typo).
 * We do: exact → contains → brewery contains. Fuzzy (trigram) matching comes
 * with Postgres pg_trgm; see docs/architecture.md.
 */
export async function findBeersByQuery(q: string, limit = 10) {
  const term = q.trim();
  if (!term) return [];
  const words = term.split(/\s+/).filter((w) => w.length >= 3);
  const exact = await db.beer.findMany({
    where: {
      OR: [
        { name: { contains: term } },
        { brewery: { name: { contains: term } } },
        ...words.map((w) => ({ name: { contains: w } })),
        ...words.map((w) => ({ brewery: { name: { contains: w } } })),
      ],
    },
    include: { brewery: true },
    take: limit,
    orderBy: { name: "asc" },
  });
  if (exact.length) return exact;
  return fuzzyBeers(term, limit);
}

/**
 * Typo tolerance ("ashai" → "Asahi"). Scans the catalogue in memory, which is
 * fine up to a few thousand beers; beyond that switch to pg_trgm similarity.
 */
async function fuzzyBeers(term: string, limit: number) {
  const all = await db.beer.findMany({ include: { brewery: true }, take: 5000 });
  const t = term.toLowerCase();
  const scored = all
    .map((b) => {
      const candidates = [b.name, b.brewery.name, ...b.name.split(/\s+/), ...b.brewery.name.split(/\s+/)].map((s) => s.toLowerCase());
      const best = Math.min(...candidates.map((c) => damerauLevenshtein(t, c)));
      return { beer: b, dist: best };
    })
    .filter(({ dist }) => dist <= Math.max(1, Math.floor(t.length / 4)))
    .sort((a, b) => a.dist - b.dist || a.beer.name.localeCompare(b.beer.name));
  return scored.slice(0, limit).map((s) => s.beer);
}

/** Edit distance counting adjacent transpositions as one edit. */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Find-or-create a beer by name + brewery name. Used by "add to tap". */
export async function upsertBeer(input: {
  name: string;
  breweryName: string;
  style?: string;
  abv?: number;
}) {
  const brewery = await db.brewery.upsert({
    where: { name: input.breweryName.trim() },
    update: {},
    create: { name: input.breweryName.trim() },
  });
  return db.beer.upsert({
    where: { name_breweryId: { name: input.name.trim(), breweryId: brewery.id } },
    update: {
      style: input.style ?? undefined,
      abv: input.abv ?? undefined,
    },
    create: {
      name: input.name.trim(),
      breweryId: brewery.id,
      style: input.style,
      abv: input.abv,
    },
    include: { brewery: true },
  });
}

export function average(nums: number[]) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}
