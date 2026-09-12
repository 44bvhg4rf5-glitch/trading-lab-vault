/** Geo helpers. Everything is WGS84 lat/lng in degrees. */

export type LatLng = { lat: number; lng: number };
export type BBox = { south: number; west: number; north: number; east: number };

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/** Bounding box around a point, used to pre-filter before exact distance. */
export function bboxAround(center: LatLng, radiusKm: number): BBox {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
}

/** Parse "south,west,north,east" (Leaflet order). */
export function parseBBox(raw: string | null): BBox | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [south, west, north, east] = parts;
  if (south > north || west > east) return null;
  return { south, west, north, east };
}

/** UK bounding box; used to reject nonsense coordinates. */
export const UK_BBOX: BBox = { south: 49.8, west: -8.7, north: 60.9, east: 1.8 };

export function isInUK(p: LatLng): boolean {
  return (
    p.lat >= UK_BBOX.south &&
    p.lat <= UK_BBOX.north &&
    p.lng >= UK_BBOX.west &&
    p.lng <= UK_BBOX.east
  );
}

/**
 * Built-in gazetteer so search works offline and without hammering Nominatim.
 * Extend freely; anything not found here falls through to the geocoder.
 */
export const UK_PLACES: Record<string, LatLng> = {
  london: { lat: 51.5074, lng: -0.1278 },
  manchester: { lat: 53.4808, lng: -2.2426 },
  richmond: { lat: 51.4613, lng: -0.3037 }, // Richmond upon Thames
  "richmond, north yorkshire": { lat: 54.4033, lng: -1.7378 },
  birmingham: { lat: 52.4862, lng: -1.8904 },
  leeds: { lat: 53.8008, lng: -1.5491 },
  liverpool: { lat: 53.4084, lng: -2.9916 },
  sheffield: { lat: 53.3811, lng: -1.4701 },
  bristol: { lat: 51.4545, lng: -2.5879 },
  newcastle: { lat: 54.9783, lng: -1.6178 },
  nottingham: { lat: 52.9548, lng: -1.1581 },
  glasgow: { lat: 55.8642, lng: -4.2518 },
  edinburgh: { lat: 55.9533, lng: -3.1883 },
  cardiff: { lat: 51.4816, lng: -3.1791 },
  belfast: { lat: 54.5973, lng: -5.9301 },
  leicester: { lat: 52.6369, lng: -1.1398 },
  brighton: { lat: 50.8225, lng: -0.1372 },
  oxford: { lat: 51.752, lng: -1.2577 },
  cambridge: { lat: 52.2053, lng: 0.1218 },
  york: { lat: 53.959, lng: -1.0815 },
  bath: { lat: 51.3811, lng: -2.359 },
  norwich: { lat: 52.6309, lng: 1.2974 },
  southampton: { lat: 50.9097, lng: -1.4044 },
  portsmouth: { lat: 50.8198, lng: -1.088 },
  plymouth: { lat: 50.3755, lng: -4.1427 },
  exeter: { lat: 50.7184, lng: -3.5339 },
  reading: { lat: 51.4543, lng: -0.9781 },
  coventry: { lat: 52.4068, lng: -1.5197 },
  hull: { lat: 53.7457, lng: -0.3367 },
  stoke: { lat: 53.0027, lng: -2.1794 },
  derby: { lat: 52.9225, lng: -1.4746 },
  aberdeen: { lat: 57.1497, lng: -2.0943 },
  dundee: { lat: 56.462, lng: -2.9707 },
  swansea: { lat: 51.6214, lng: -3.9436 },
  shoreditch: { lat: 51.5255, lng: -0.0775 },
  soho: { lat: 51.5137, lng: -0.1366 },
  clapham: { lat: 51.4622, lng: -0.1381 },
  chorlton: { lat: 53.4426, lng: -2.2749 },
  didsbury: { lat: 53.4166, lng: -2.2313 },
  "northern quarter": { lat: 53.4837, lng: -2.2352 },
};

/** Resolve a place name to coordinates: gazetteer first, then Nominatim. */
export async function geocodePlace(place: string): Promise<(LatLng & { label: string }) | null> {
  const key = place.trim().toLowerCase();
  if (!key) return null;
  const hit = UK_PLACES[key];
  if (hit) return { ...hit, label: titleCase(key) };

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", place);
    url.searchParams.set("countrycodes", "gb");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const res = await fetch(url, {
      headers: { "User-Agent": process.env.GEOCODER_USER_AGENT ?? "draft-map-dev" },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!rows.length) return null;
    return {
      lat: Number(rows[0].lat),
      lng: Number(rows[0].lon),
      label: rows[0].display_name.split(",")[0],
    };
  } catch {
    return null;
  }
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
