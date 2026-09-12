"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignInDialog } from "./Nav";

type Suggestion = { id: string; name: string; brewery: string; style: string | null; abv: number | null };

export function AddTapForm({ pubId, signedIn }: { pubId: string; signedIn: boolean }) {
  const router = useRouter();
  const [beerName, setBeerName] = useState("");
  const [breweryName, setBreweryName] = useState("");
  const [price, setPrice] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);

  useEffect(() => {
    if (beerName.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/beers?q=${encodeURIComponent(beerName)}`, { signal: ctrl.signal }).catch(() => null);
      if (res?.ok) setSuggestions((await res.json()).beers);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [beerName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn) return setNeedSignIn(true);
    setBusy(true);
    setError(null);
    const pricePence = price ? Math.round(Number(price) * 100) : undefined;
    const res = await fetch(`/api/pubs/${pubId}/taps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beerName, breweryName, pricePence: Number.isFinite(pricePence) ? pricePence : undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Couldn't add that");
      return;
    }
    setBeerName("");
    setBreweryName("");
    setPrice("");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={submit} className="grid sm:grid-cols-[1fr_1fr_6rem_auto] gap-2 items-start">
        <div className="relative">
          <input
            required
            value={beerName}
            onChange={(e) => {
              setBeerName(e.target.value);
              if (e.target.value.trim().length < 2) setSuggestions([]);
            }}
            placeholder="Beer name"
            className="w-full border rounded px-3 py-2"
          />
          {suggestions.length > 0 && !suggestions.some((s) => s.name === beerName && s.brewery === breweryName) && (
            <ul className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-auto text-sm">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-stone-100"
                    onClick={() => {
                      setBeerName(s.name);
                      setBreweryName(s.brewery);
                      setSuggestions([]);
                    }}
                  >
                    {s.name} <span className="text-stone-500">· {s.brewery}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input required value={breweryName} onChange={(e) => setBreweryName(e.target.value)} placeholder="Brewery" className="border rounded px-3 py-2" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="£ pint" inputMode="decimal" className="border rounded px-3 py-2" />
        <button disabled={busy} className="bg-stone-900 text-white rounded px-4 py-2 disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      {needSignIn && <SignInDialog onClose={() => setNeedSignIn(false)} />}
    </>
  );
}
