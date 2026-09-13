"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignInDialog } from "./Nav";
import { BoardScanner } from "./BoardScanner";

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

/**
 * One list, stated as fact. Inferred listings (source/confidence in the data)
 * are not visually distinguished: the product promise is that we already know
 * what's on. Corrections live behind "Report a change" so the default view
 * never asks the drinker to do our job.
 */
export function TapList({ taps, signedIn, pubId }: { taps: TapView[]; signedIn: boolean; pubId: string }) {
  const [needSignIn, setNeedSignIn] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      {taps.length ? (
        <ul className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {taps.map((t) => (
            <TapRow key={t.id} tap={t} signedIn={signedIn} editing={editing} onNeedSignIn={() => setNeedSignIn(true)} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-stone-600 rounded-lg border border-dashed border-stone-300 p-4">We don&apos;t have this bar&apos;s range yet.</p>
      )}
      <p className="mt-2 text-xs text-stone-500">
        <button type="button" onClick={() => (signedIn ? setEditing((e) => !e) : setNeedSignIn(true))} className="underline">
          {editing ? "Done" : "Something wrong with this list? Report a change"}
        </button>
      </p>
      {editing && (
        <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <BoardScanner pubId={pubId} owner={false} onDone={() => setEditing(false)} />
        </div>
      )}
      {needSignIn && <SignInDialog onClose={() => setNeedSignIn(false)} />}
    </>
  );
}

function TapRow({ tap, signedIn, editing, onNeedSignIn }: { tap: TapView; signedIn: boolean; editing: boolean; onNeedSignIn: () => void }) {
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

  const remove = () =>
    gate(async () => {
      setBusy("remove");
      const res = await fetch(`/api/taps/${tap.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove" }) });
      setBusy(null);
      if (res.ok) {
        setMsg("Thanks. Removed from the list.");
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
          {tap.avgScore != null && (
            <span title={`${tap.ratingCount} rating${tap.ratingCount === 1 ? "" : "s"}`}>★ {tap.avgScore} <span className="text-stone-400">({tap.ratingCount})</span></span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Stars value={tap.myScore} onRate={rate} label="Rate this beer here" disabled={busy === "rate"} />
        <div className="flex gap-2 ml-auto">
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
          {editing && (
            <button onClick={remove} disabled={busy !== null} className="text-xs rounded border px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50">
              ✕ Not on here
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
