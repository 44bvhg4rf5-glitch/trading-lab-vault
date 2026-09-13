"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignInDialog } from "./Nav";

export type TapView = {
  id: string;
  beerId: string;
  beer: string;
  brewery: string;
  style: string | null;
  abv: number | null;
  pricePence: number | null;
  servingMl: number;
  lastSeenAt: string;
  confirmations: number;
  source: string;
  confidence: number;
  inferredFrom: string | null;
  avgScore: number | null;
  ratingCount: number;
  myScore: number | null;
  photos: { id: string; url: string; kind: string; caption: string | null; by: string; avgPourScore: number | null; ratingCount: number }[];
};

export function TapList({ taps, signedIn }: { taps: TapView[]; signedIn: boolean }) {
  const [needSignIn, setNeedSignIn] = useState(false);
  if (!taps.length) {
    return <p className="mt-2 text-sm text-stone-600 rounded-lg border border-dashed border-stone-300 p-4">No tap list yet. Be the first to add what&apos;s pouring.</p>;
  }
  const confirmed = taps.filter((t) => t.confidence >= 1);
  const likely = taps.filter((t) => t.confidence < 1);
  const rangeName = likely.find((t) => t.source === "inferred")?.inferredFrom;
  return (
    <>
      {confirmed.length > 0 && (
        <ul className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {confirmed.map((t) => (
            <TapRow key={t.id} tap={t} signedIn={signedIn} onNeedSignIn={() => setNeedSignIn(true)} />
          ))}
        </ul>
      )}
      {likely.length > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-semibold text-stone-700">Likely on tap</h3>
            <span className="text-xs text-stone-500">
              {rangeName && rangeName !== "UK default pub" ? `Standard range for ${rangeName} pubs` : rangeName === "UK default pub" ? "On the bar in nearly every UK pub" : "From OpenStreetMap"} · not yet confirmed here
            </span>
          </div>
          <ul className="mt-1 divide-y divide-stone-200 rounded-lg border border-dashed border-stone-300 bg-stone-50">
            {likely.map((t) => (
              <TapRow key={t.id} tap={t} signedIn={signedIn} onNeedSignIn={() => setNeedSignIn(true)} />
            ))}
          </ul>
        </div>
      )}
      {needSignIn && <SignInDialog onClose={() => setNeedSignIn(false)} />}
    </>
  );
}

function TapRow({ tap, signedIn, onNeedSignIn }: { tap: TapView; signedIn: boolean; onNeedSignIn: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function gate(fn: () => Promise<void>) {
    return async () => {
      if (!signedIn) return onNeedSignIn();
      await fn();
    };
  }

  const rate = (score: number) =>
    gate(async () => {
      setBusy("rate");
      const res = await fetch(`/api/taps/${tap.id}/ratings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score }) });
      setBusy(null);
      if (res.ok) router.refresh();
    })();

  const act = (action: "confirm" | "remove") =>
    gate(async () => {
      setBusy(action);
      const res = await fetch(`/api/taps/${tap.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      setBusy(null);
      if (res.ok) {
        setMsg(action === "confirm" ? "Thanks — marked as still on." : "Thanks — removed from the tap list.");
        router.refresh();
      }
    })();

  const upload = (file: File, kind: string) =>
    gate(async () => {
      setBusy("photo");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", kind);
      const res = await fetch(`/api/taps/${tap.id}/photos`, { method: "POST", body: fd });
      setBusy(null);
      if (res.ok) {
        setShowPhotos(true);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error ?? "Upload failed");
      }
    })();

  const ratePour = (photoId: string, score: number) =>
    gate(async () => {
      const res = await fetch(`/api/photos/${photoId}/ratings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score }) });
      if (res.ok) router.refresh();
    })();

  const seenAgo = timeAgo(new Date(tap.lastSeenAt));

  return (
    <li className="p-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={`/beer/${tap.beerId}`} className="font-medium hover:underline">
          {tap.beer}
        </Link>
        <span className="text-sm text-stone-500">
          {tap.brewery}
          {tap.style ? ` · ${tap.style.replace("_", " ")}` : ""}
          {tap.abv != null ? ` · ${tap.abv}%` : ""}
        </span>
        <span className="ml-auto text-sm text-stone-700">
          {tap.pricePence != null && <span className="mr-3">£{(tap.pricePence / 100).toFixed(2)}{tap.servingMl !== 568 ? ` / ${tap.servingMl}ml` : ""}</span>}
          {tap.avgScore != null ? (
            <span title={`${tap.ratingCount} rating${tap.ratingCount === 1 ? "" : "s"}`}>★ {tap.avgScore} <span className="text-stone-400">({tap.ratingCount})</span></span>
          ) : (
            <span className="text-stone-400">unrated</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Stars value={tap.myScore} onRate={rate} label="Rate this beer here" disabled={busy === "rate"} />
        <span className="text-xs text-stone-500">
          {tap.confidence < 1
            ? `likely · ${Math.round(tap.confidence * 100)}% · ${tap.confirmations} confirm${tap.confirmations === 1 ? "" : "s"}`
            : `seen ${seenAgo} · ${tap.confirmations} confirm${tap.confirmations === 1 ? "" : "s"}`}
        </span>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => act("confirm")} disabled={busy !== null} className="text-xs rounded border px-2 py-1 hover:bg-stone-50 disabled:opacity-50">
            {tap.confidence < 1 ? "✓ Yes, it's on" : "✓ Still on"}
          </button>
          <button onClick={() => act("remove")} disabled={busy !== null} className="text-xs rounded border px-2 py-1 hover:bg-stone-50 disabled:opacity-50">
            ✕ Gone
          </button>
          <label className="text-xs rounded border px-2 py-1 hover:bg-stone-50 cursor-pointer">
            📷 {busy === "photo" ? "Uploading…" : "Photo of the pour"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f, "POUR");
                e.target.value = "";
              }}
            />
          </label>
          {tap.photos.length > 0 && (
            <button onClick={() => setShowPhotos((s) => !s)} className="text-xs underline text-stone-600">
              {tap.photos.length} photo{tap.photos.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>

      {msg && <p className="text-xs text-emerald-700">{msg}</p>}

      {showPhotos && tap.photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {tap.photos.map((p) => (
            <figure key={p.id} className="text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption ?? `${tap.beer} pour`} className="aspect-square object-cover rounded" />
              <figcaption className="mt-1 text-stone-600">
                <div>{p.by}</div>
                <div className="flex items-center gap-1">
                  <span>Pour:</span>
                  <Stars value={null} onRate={(s) => ratePour(p.id, s)} label="Rate the pour" small />
                  {p.avgPourScore != null && <span>{p.avgPourScore} ({p.ratingCount})</span>}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </li>
  );
}

export function Stars({ value, onRate, label, disabled, small }: { value: number | null; onRate: (s: number) => void; label: string; disabled?: boolean; small?: boolean }) {
  return (
    <span role="radiogroup" aria-label={label} className={`inline-flex ${small ? "text-sm" : "text-lg"} leading-none`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          disabled={disabled}
          onClick={() => onRate(s)}
          className={`${value != null && s <= value ? "text-amber-500" : "text-stone-300"} hover:text-amber-400 disabled:opacity-50`}
          title={`${s} / 5`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function timeAgo(d: Date) {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
