import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/plans";

export const metadata: Metadata = { title: "For pubs" };

export default async function ForPubsPage() {
  const user = await getCurrentUser();
  const myPubs = user ? await db.pub.findMany({ where: { claimedById: user.id }, include: { subscription: true } }) : [];

  return (
    <main className="max-w-4xl w-full mx-auto p-4 space-y-8">
      <section className="pt-6">
        <h1 className="text-3xl font-semibold tracking-tight">Put your taps in front of people who are already looking for them.</h1>
        <p className="mt-3 text-stone-600 max-w-2xl">
          Drinkers search Draft Map for a specific beer in a specific place. If you pour it, they should find you. Claim your pub to
          keep your tap list accurate, then post events and deals when you want to fill the room.
        </p>
      </section>

      {myPubs.length > 0 && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="font-semibold">Your pubs</h2>
          <ul className="mt-2 space-y-1">
            {myPubs.map((p) => (
              <li key={p.id}>
                <Link href={`/for-pubs/${p.id}`} className="underline">{p.name}</Link>{" "}
                <span className="text-sm text-stone-500">· {p.subscription?.plan ?? "FREE"} plan</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-3">How to claim</h2>
        <ol className="list-decimal ml-5 space-y-1 text-stone-700">
          <li>Sign in (top right), then find your pub on the <Link href="/" className="underline">map</Link>.</li>
          <li>Open its page and choose <em>Own this pub? Claim it</em>.</li>
          <li>Pick a plan below. Free is genuinely free: your tap list, verified badge, and demand insights for your area.</li>
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Plans</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {(Object.entries(PLAN_LIMITS) as [keyof typeof PLAN_LIMITS, (typeof PLAN_LIMITS)[keyof typeof PLAN_LIMITS]][]).map(([name, p]) => (
            <div key={name} className={`rounded-lg border p-4 bg-white ${name === "PROMOTED" ? "border-amber-400 ring-1 ring-amber-200" : "border-stone-200"}`}>
              <div className="font-semibold">{name.charAt(0) + name.slice(1).toLowerCase()}</div>
              <div className="text-2xl mt-1">
                £{p.pricePerMonthGbp}
                <span className="text-sm text-stone-500">/mo</span>
              </div>
              <ul className="mt-3 text-sm text-stone-700 space-y-1">
                <li>✓ Verified listing &amp; tap list control</li>
                <li>✓ Area demand insights</li>
                <li>{p.events ? `✓ ${p.events === Infinity ? "Unlimited" : p.events} live events` : "– Events"}</li>
                <li>{p.deals ? `✓ ${p.deals === Infinity ? "Unlimited" : p.deals} live deals` : "– Deals"}</li>
                <li>{p.promoted ? "✓ Promoted in search results & map" : "– Promoted placement"}</li>
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">Billing is in demo mode in this build. See docs/monetisation.md for the Stripe wiring.</p>
      </section>
    </main>
  );
}
