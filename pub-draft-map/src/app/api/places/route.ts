import { handle, ok } from "@/lib/api";
import { findPlaces, placeKind, placeLabel } from "@/lib/places";

/** GET /api/places?q=haref — typeahead over every UK town and village. */
export const GET = handle(async (req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return ok({
    places: findPlaces(q, 7).map((p) => ({ name: p.name, label: placeLabel(p), kind: placeKind(p), lat: p.lat, lng: p.lng })),
  });
});
