"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapPub } from "./PubMap";
import { AdSlot } from "./AdSlot";

const PubMap = dynamic(() => import("./PubMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-lg bg-stone-200 animate-pulse" />,
});

type SearchResult = {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  street: string | null;
  city: string | null;
  distanceKm: number;
  plan: string;
  matches: { tapListingId: string; beer: string; brewery: string; pricePence: number | null; avgScore: number | null; ratingCount: number; lastSeenAt: string }[];
};

const DEFAULT_CENTER = { lat: 53.4808, lng: -2.2426 }; // Manchester

export function MapExplorer({ initialBeer = "", initialNear = "" }: { initialBeer?: string; initialNear?: string }) {
  const [beer, setBeer] = useState(initialBeer);
  const [near, setNear] = useState(initialNear);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [viewportPubs, setViewportPubs] = useState<MapPub[]>([]);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bboxRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadViewport = useCallback(async (bbox: string) => {
    bboxRef.current = bbox;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/pubs?bbox=${bbox}`, { signal: ctrl.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.code === "BBOX_TOO_LARGE") setViewportPubs([]);
        return;
      }
      const { pubs } = await res.json();
      setViewportPubs(pubs);
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error(e);
    }
  }, []);

  const runSearch = useCallback(
    async (b: string, n: string) => {
      if (!b.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ beer: b.trim() });
        if (n.trim()) params.set("near", n.trim());
        else {
          params.set("lat", String(center.lat));
          params.set("lng", String(center.lng));
        }
        const res = await fetch(`/api/search?${params}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Search failed");
          setResults(null);
          return;
        }
        setResults(json.results);
        setSearchInfo(
          `${json.results.length} place${json.results.length === 1 ? "" : "s"} with “${json.query.beer}” on draft${json.query.near ? ` near ${json.query.near}` : " near you"}`,
        );
        if (json.query.center) setCenter(json.query.center);
        const url = new URL(window.location.href);
        url.searchParams.set("beer", b.trim());
        if (n.trim()) url.searchParams.set("near", n.trim());
        else url.searchParams.delete("near");
        window.history.replaceState(null, "", url);
      } finally {
        setBusy(false);
      }
    },
    [center.lat, center.lng],
  );

  // Deep link (/?beer=asahi&near=Richmond): run the search once on mount.
  useEffect(() => {
    if (!initialBeer) return;
    const t = setTimeout(() => runSearch(initialBeer, initialNear), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNear("");
      },
      () => setError("Couldn't get your location"),
    );
  }

  const resultIds = useMemo(() => new Set(results?.map((r) => r.id) ?? []), [results]);
  const mapPubs: MapPub[] = useMemo(() => {
    const merged = new Map<string, MapPub>();
    for (const p of viewportPubs) merged.set(p.id, { ...p, highlight: resultIds.has(p.id) });
    for (const r of results ?? []) merged.set(r.id, { id: r.id, name: r.name, kind: r.kind, lat: r.lat, lng: r.lng, city: r.city, plan: r.plan, highlight: true });
    return [...merged.values()];
  }, [viewportPubs, results, resultIds]);

  const fitTo = useMemo(() => {
    if (!results?.length) return null;
    const lats = results.map((r) => r.lat);
    const lngs = results.map((r) => r.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ] as [[number, number], [number, number]];
  }, [results]);

  return (
    <div className="flex-1 flex flex-col">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(beer, near);
        }}
        className="bg-white border-b border-stone-200 px-4 py-3"
      >
        <div className="max-w-6xl mx-auto flex flex-wrap gap-2 items-center">
          <input
            value={beer}
            onChange={(e) => setBeer(e.target.value)}
            placeholder="Beer, e.g. Asahi, Guinness, Cloudwater"
            className="flex-1 min-w-[12rem] border rounded px-3 py-2"
            aria-label="Beer"
          />
          <input
            value={near}
            onChange={(e) => setNear(e.target.value)}
            placeholder="Near… Manchester, Richmond, TW9"
            className="flex-1 min-w-[10rem] border rounded px-3 py-2"
            aria-label="Place"
          />
          <button type="button" onClick={useMyLocation} className="text-sm underline text-stone-600" title="Use my location">
            📍 Near me
          </button>
          <button disabled={busy} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-900 font-medium rounded px-4 py-2">
            {busy ? "Searching…" : "Find it on draft"}
          </button>
        </div>
        {(error || searchInfo) && (
          <p className={`max-w-6xl mx-auto mt-2 text-sm ${error ? "text-red-600" : "text-stone-600"}`}>{error ?? searchInfo}</p>
        )}
      </form>

      <div className="flex-1 max-w-6xl w-full mx-auto grid grid-cols-1 md:grid-cols-[1fr_22rem] gap-4 p-4 min-h-[60vh]">
        <div className="h-[55vh] md:h-auto md:min-h-[70vh]">
          <PubMap pubs={mapPubs} center={center} fitTo={fitTo} onBoundsChange={loadViewport} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        <aside className="space-y-3">
          {results ? (
            results.length ? (
              <ol className="space-y-2">
                {results.map((r, i) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left rounded-lg border bg-white p-3 hover:border-amber-400 ${selectedId === r.id ? "border-amber-500 ring-1 ring-amber-300" : "border-stone-200"}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">
                          <Link href={`/pub/${r.id}`} className="hover:underline">{r.name}</Link>
                        </span>
                        <span className="text-xs text-stone-500 whitespace-nowrap">{r.distanceKm} km</span>
                      </div>
                      <div className="text-xs text-stone-500">
                        {[r.street, r.city].filter(Boolean).join(", ")}
                        {r.plan === "PROMOTED" && <span className="ml-2 text-amber-700 font-medium">Promoted</span>}
                      </div>
                      <ul className="mt-1 text-sm">
                        {r.matches.map((m) => (
                          <li key={m.tapListingId} className="flex justify-between gap-2">
                            <span>
                              {m.beer} <span className="text-stone-400">· {m.brewery}</span>
                            </span>
                            <span className="text-stone-600 whitespace-nowrap">
                              {m.avgScore != null ? `★ ${m.avgScore}` : "unrated"}
                              {m.pricePence != null ? ` · £${(m.pricePence / 100).toFixed(2)}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </button>
                    {i === 1 && <AdSlot slot="results-native" className="mt-2" />}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
                Nothing found. Try a wider area, or if you know a pub that pours it, open the pub and add it to their tap list.
              </div>
            )
          ) : (
            <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600 space-y-2">
              <p className="font-medium text-stone-800">{viewportPubs.length} pubs and bars in view</p>
              <p>Search a beer to see exactly where it&apos;s pouring, or click a pub to see its taps.</p>
              <p className="text-xs">Tap lists are crowd-sourced. If you&apos;re at the bar, add what you see and rate the pour.</p>
            </div>
          )}
          <AdSlot slot="map-sidebar" />
        </aside>
      </div>
    </div>
  );
}
