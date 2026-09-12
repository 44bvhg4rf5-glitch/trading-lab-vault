import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { average } from "@/lib/beers";
import { AdSlot } from "@/components/AdSlot";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const beer = await db.beer.findUnique({ where: { id }, include: { brewery: true } });
  return { title: beer ? `Where is ${beer.name} on draft?` : "Beer" };
}

export default async function BeerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const beer = await db.beer.findUnique({
    where: { id },
    include: {
      brewery: true,
      ratings: { select: { score: true } },
      tapListings: {
        where: { status: "ACTIVE" },
        include: { pub: { include: { subscription: true } }, ratings: { select: { score: true } } },
        orderBy: { lastSeenAt: "desc" },
      },
    },
  });
  if (!beer) notFound();

  const byCity = new Map<string, typeof beer.tapListings>();
  for (const t of beer.tapListings) {
    const key = t.pub.city ?? "Elsewhere";
    byCity.set(key, [...(byCity.get(key) ?? []), t]);
  }
  const overall = average(beer.ratings.map((r) => r.score));

  return (
    <main className="max-w-4xl w-full mx-auto p-4 space-y-6">
      <header>
        <Link href={`/?beer=${encodeURIComponent(beer.name)}`} className="text-sm text-stone-500 hover:underline">← Search on map</Link>
        <h1 className="text-2xl font-semibold mt-1">{beer.name}</h1>
        <p className="text-stone-600">
          {beer.brewery.name}
          {beer.style ? ` · ${beer.style.replace("_", " ")}` : ""}
          {beer.abv != null ? ` · ${beer.abv}%` : ""}
          {overall != null && (
            <span className="ml-3">
              ★ {overall} <span className="text-stone-400">({beer.ratings.length} rating{beer.ratings.length === 1 ? "" : "s"})</span>
            </span>
          )}
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-2">On draft at {beer.tapListings.length} place{beer.tapListings.length === 1 ? "" : "s"}</h2>
        {[...byCity.entries()].map(([city, taps]) => (
          <div key={city} className="mb-4">
            <h3 className="text-sm uppercase tracking-wide text-stone-500 mb-1">
              <Link href={`/?beer=${encodeURIComponent(beer.name)}&near=${encodeURIComponent(city)}`} className="hover:underline">{city}</Link>
            </h3>
            <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {taps.map((t) => {
                const avg = average(t.ratings.map((r) => r.score));
                return (
                  <li key={t.id} className="p-3 flex flex-wrap items-baseline gap-x-3">
                    <Link href={`/pub/${t.pub.id}`} className="font-medium hover:underline">{t.pub.name}</Link>
                    <span className="text-sm text-stone-500">{[t.pub.street, t.pub.postcode].filter(Boolean).join(", ")}</span>
                    {t.pub.subscription?.plan === "PROMOTED" && <span className="text-xs text-amber-700">Promoted</span>}
                    <span className="ml-auto text-sm text-stone-700">
                      {t.pricePence != null && <span className="mr-3">£{(t.pricePence / 100).toFixed(2)}</span>}
                      {avg != null ? `★ ${avg}` : <span className="text-stone-400">unrated</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {beer.tapListings.length === 0 && <p className="text-sm text-stone-600">Nobody has reported this on draft yet.</p>}
      </section>

      <AdSlot slot="pub-inline" />
    </main>
  );
}
