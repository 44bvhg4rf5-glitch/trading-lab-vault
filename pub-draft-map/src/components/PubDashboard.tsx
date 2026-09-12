"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";

type EventRow = { id: string; title: string; startsAt: string; promoted: boolean };
type DealRow = { id: string; title: string; validTo: string | null; promoted: boolean };
type Demand = { mostSearched: { beer: string; brewery: string; searches: number }[]; mostPosted: { beer: string; brewery: string; photos: number }[] };

export function PubDashboard({ pubId, city, plan, events, deals }: { pubId: string; city: string | null; plan: Plan; events: EventRow[]; deals: DealRow[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [demand, setDemand] = useState<Demand | null>(null);

  useEffect(() => {
    fetch(`/api/insights/demand?place=${encodeURIComponent(city ?? "")}&days=30`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDemand)
      .catch(() => null);
  }, [city]);

  async function post(path: string, body: unknown) {
    setMsg(null);
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "Failed");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-3 md:col-span-2">
        <h2 className="font-semibold">Plan</h2>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLAN_LIMITS) as Plan[]).map((p) => (
            <button
              key={p}
              onClick={() => post(`/api/pubs/${pubId}/subscription`, { plan: p })}
              className={`rounded border px-3 py-1.5 text-sm ${plan === p ? "bg-stone-900 text-white border-stone-900" : "hover:bg-stone-50"}`}
            >
              {p.charAt(0) + p.slice(1).toLowerCase()} · £{PLAN_LIMITS[p].pricePerMonthGbp}/mo
            </button>
          ))}
        </div>
        <p className="text-xs text-stone-500">Demo billing: switching plans is instant. Production routes this through Stripe Checkout.</p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">Events</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const fd = new FormData(f);
            const ok = await post(`/api/pubs/${pubId}/events`, {
              title: fd.get("title"),
              description: fd.get("description") || undefined,
              startsAt: new Date(String(fd.get("startsAt"))).toISOString(),
            });
            if (ok) f.reset();
          }}
          className="space-y-2"
        >
          <input name="title" required placeholder="Quiz night, tap takeover, live music…" className="w-full border rounded px-3 py-2" />
          <input name="startsAt" type="datetime-local" required className="w-full border rounded px-3 py-2" />
          <textarea name="description" placeholder="Details (optional)" className="w-full border rounded px-3 py-2" rows={2} />
          <button className="bg-stone-900 text-white rounded px-4 py-2 text-sm">Post event</button>
        </form>
        <ul className="text-sm divide-y">
          {events.map((e) => (
            <li key={e.id} className="py-1.5 flex justify-between gap-2">
              <span>{e.title}</span>
              <span className="text-stone-500">
                {new Date(e.startsAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {e.promoted && <span className="ml-2 text-amber-700">promoted</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">Deals</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const fd = new FormData(f);
            const validTo = fd.get("validTo") ? new Date(String(fd.get("validTo"))).toISOString() : undefined;
            const ok = await post(`/api/pubs/${pubId}/deals`, { title: fd.get("title"), description: fd.get("description") || undefined, validTo });
            if (ok) f.reset();
          }}
          className="space-y-2"
        >
          <input name="title" required placeholder="2-for-1 pints Mon–Thu 5–7pm" className="w-full border rounded px-3 py-2" />
          <input name="validTo" type="date" className="w-full border rounded px-3 py-2" />
          <textarea name="description" placeholder="Terms (optional)" className="w-full border rounded px-3 py-2" rows={2} />
          <button className="bg-stone-900 text-white rounded px-4 py-2 text-sm">Post deal</button>
        </form>
        <ul className="text-sm divide-y">
          {deals.map((d) => (
            <li key={d.id} className="py-1.5 flex justify-between gap-2">
              <span>{d.title}</span>
              <span className="text-stone-500">
                {d.validTo ? `until ${new Date(d.validTo).toLocaleDateString("en-GB")}` : "open-ended"}
                {d.promoted && <span className="ml-2 text-amber-700">promoted</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-3 md:col-span-2">
        <h2 className="font-semibold">What people want in {city ?? "your area"} (last 30 days)</h2>
        {!demand ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-1">Most searched beers</h3>
              {demand.mostSearched.length ? (
                <ol className="list-decimal ml-5 space-y-0.5">
                  {demand.mostSearched.map((b) => (
                    <li key={b.beer + b.brewery}>
                      {b.beer} <span className="text-stone-400">· {b.brewery}</span> — {b.searches}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-stone-500">No searches logged yet.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-1">Most photographed pours</h3>
              {demand.mostPosted.length ? (
                <ol className="list-decimal ml-5 space-y-0.5">
                  {demand.mostPosted.map((b) => (
                    <li key={b.beer + b.brewery}>
                      {b.beer} <span className="text-stone-400">· {b.brewery}</span> — {b.photos}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-stone-500">No photos yet.</p>
              )}
            </div>
          </div>
        )}
        <p className="text-xs text-stone-500">Aggregated, anonymous. The paid data product breaks this down by postcode district and week.</p>
      </section>

      {msg && <p className="md:col-span-2 text-sm text-red-600">{msg}</p>}
    </div>
  );
}
