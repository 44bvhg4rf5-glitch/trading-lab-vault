"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Proposed = { name: string; brewery: string | null; style: string | null; abv: number | null; price_pence: number | null; serving: string | null; confidence: number };

/**
 * Photograph the beer board → Claude reads it → user ticks what's right → publish.
 * Used by pub owners (dashboard) and drinkers (behind "Report a change").
 */
export function BoardScanner({ pubId, owner, onDone }: { pubId: string; owner: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"reading" | "publishing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [rows, setRows] = useState<(Proposed & { keep: boolean })[] | null>(null);
  const [replace, setReplace] = useState(owner);

  async function read(file: File) {
    setBusy("reading");
    setError(null);
    setRows(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/pubs/${pubId}/board`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(j.error ?? "Couldn't read that photo");
    if (!j.isDrinksList) return setError("That doesn't look like a beer board or drinks menu. Try a clearer shot of the pumps or the board.");
    setNotes(j.notes ?? null);
    setRows(j.proposed.map((p: Proposed) => ({ ...p, keep: p.confidence >= 0.6 })));
  }

  async function publish() {
    if (!rows) return;
    const beers = rows.filter((r) => r.keep).map(({ name, brewery, style, abv, price_pence }) => ({ name, brewery, style, abv, price_pence }));
    if (!beers.length) return setError("Tick at least one beer");
    setBusy("publishing");
    const res = await fetch(`/api/pubs/${pubId}/board`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beers, replace }) });
    setBusy(null);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't publish");
    setRows(null);
    router.refresh();
    onDone?.();
  }

  return (
    <div className="space-y-3">
      <label className="inline-flex items-center gap-2 cursor-pointer rounded border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
        📷 {busy === "reading" ? "Reading the board…" : owner ? "Photograph your beer board" : "Snap the beer board"}
        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
      </label>
      <p className="text-xs text-stone-500">Pump clips, a chalkboard or a printed drinks menu all work. We read it and you tick what&apos;s right.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows && (
        <div className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
          {notes && <p className="text-xs text-stone-500">{notes}</p>}
          <ul className="divide-y divide-stone-100">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-3 py-1.5 text-sm">
                <input type="checkbox" checked={r.keep} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                <span className="flex-1">
                  <input
                    value={r.name}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className="w-full border-b border-transparent focus:border-stone-300 bg-transparent"
                  />
                  <span className="text-xs text-stone-500">
                    {r.brewery ?? ""}{r.abv != null ? ` · ${r.abv}%` : ""}{r.price_pence != null ? ` · £${(r.price_pence / 100).toFixed(2)}` : ""}
                    {r.confidence < 0.6 && <span className="ml-2 text-amber-700">check this one</span>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            This photo shows the whole board: remove anything not in it
          </label>
          <div className="flex gap-2">
            <button onClick={publish} disabled={busy !== null} className="bg-stone-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50">
              {busy === "publishing" ? "Publishing…" : `Publish ${rows.filter((r) => r.keep).length} beers`}
            </button>
            <button onClick={() => setRows(null)} className="text-sm underline text-stone-600">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
