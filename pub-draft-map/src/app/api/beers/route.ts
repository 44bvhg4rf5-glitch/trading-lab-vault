import { handle, ok } from "@/lib/api";
import { findBeersByQuery } from "@/lib/beers";

/** GET /api/beers?q=asa — typeahead for beer names. */
export const GET = handle(async (req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const beers = await findBeersByQuery(q, 8);
  return ok({
    beers: beers.map((b) => ({ id: b.id, name: b.name, brewery: b.brewery.name, style: b.style, abv: b.abv })),
  });
});
