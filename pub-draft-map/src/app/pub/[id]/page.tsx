import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { average } from "@/lib/beers";
import { daysAgo, now } from "@/lib/time";
import { AdSlot } from "@/components/AdSlot";
import { TapList } from "@/components/TapList";
import { AddTapForm } from "@/components/AddTapForm";
import { ClaimPubButton } from "@/components/ClaimPubButton";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const pub = await db.pub.findUnique({ where: { id }, select: { name: true, city: true } });
  return { title: pub ? `${pub.name}${pub.city ? `, ${pub.city}` : ""} — what's on draft` : "Pub" };
}

export default async function PubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = now();
  const yesterday = daysAgo(1);
  const [pub, user] = await Promise.all([
    db.pub.findUnique({
      where: { id },
      include: {
        subscription: true,
        tapListings: {
          where: { status: "ACTIVE" },
          include: {
            beer: { include: { brewery: true } },
            ratings: { select: { score: true, userId: true } },
            photos: { include: { ratings: { select: { score: true } }, user: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 6 },
          },
          orderBy: { lastSeenAt: "desc" },
        },
        events: {
          where: { OR: [{ endsAt: null, startsAt: { gte: yesterday } }, { endsAt: { gte: today } }] },
          orderBy: { startsAt: "asc" },
        },
        deals: { where: { OR: [{ validTo: null }, { validTo: { gte: today } }] }, orderBy: { createdAt: "desc" } },
      },
    }),
    getCurrentUser(),
  ]);
  if (!pub) notFound();

  const isOwner = Boolean(user && (pub.claimedById === user.id || user.role === "ADMIN"));
  const taps = pub.tapListings.map((t) => ({
    id: t.id,
    beerId: t.beerId,
    beer: t.beer.name,
    brewery: t.beer.brewery.name,
    style: t.beer.style,
    abv: t.beer.abv,
    pricePence: t.pricePence,
    servingMl: t.servingMl,
    lastSeenAt: t.lastSeenAt.toISOString(),
    confirmations: t.confirmations,
    source: t.source,
    confidence: t.confidence,
    inferredFrom: t.inferredFrom,
    avgScore: average(t.ratings.map((r) => r.score)),
    ratingCount: t.ratings.length,
    myScore: user ? (t.ratings.find((r) => r.userId === user.id)?.score ?? null) : null,
    photos: t.photos.map((p) => ({
      id: p.id,
      url: p.url,
      kind: p.kind,
      caption: p.caption,
      by: p.user.displayName,
      avgPourScore: average(p.ratings.map((r) => r.score)),
      ratingCount: p.ratings.length,
    })),
  }));

  return (
    <main className="max-w-6xl w-full mx-auto p-4 grid grid-cols-1 md:grid-cols-[1fr_20rem] gap-6">
      <div className="space-y-6">
        <header>
          <Link href="/" className="text-sm text-stone-500 hover:underline">← Map</Link>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1">
            <h1 className="text-2xl font-semibold">{pub.name}</h1>
            <span className="text-sm text-stone-500 capitalize">{pub.kind.replace("_", " ")}</span>
            {pub.subscription?.plan === "PROMOTED" && <span className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-0.5">Promoted</span>}
            {pub.claimedById && <span className="text-xs bg-emerald-100 text-emerald-800 rounded px-2 py-0.5">Verified listing</span>}
          </div>
          <p className="text-sm text-stone-600">
            {[pub.street, pub.city, pub.postcode].filter(Boolean).join(", ")}
            {pub.website && (
              <>
                {" · "}
                <a href={pub.website} className="underline" rel="nofollow noopener">Website</a>
              </>
            )}
          </p>
          <div className="mt-2 flex gap-3 text-sm">
            <a className="underline text-stone-600" href={`https://www.openstreetmap.org/?mlat=${pub.lat}&mlon=${pub.lng}#map=18/${pub.lat}/${pub.lng}`} rel="noopener">
              Open in map
            </a>
            {isOwner ? (
              <Link href={`/for-pubs/${pub.id}`} className="underline text-amber-700 font-medium">Manage this pub</Link>
            ) : (
              !pub.claimedById && <ClaimPubButton pubId={pub.id} signedIn={Boolean(user)} />
            )}
          </div>
        </header>

        {(pub.deals.length > 0 || pub.events.length > 0) && (
          <section className="grid sm:grid-cols-2 gap-3">
            {pub.deals.map((d) => (
              <div key={d.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="text-xs uppercase tracking-wide text-amber-700">Deal</div>
                <div className="font-medium">{d.title}</div>
                {d.description && <p className="text-sm text-stone-600">{d.description}</p>}
                {d.validTo && <p className="text-xs text-stone-500 mt-1">Until {d.validTo.toLocaleDateString("en-GB")}</p>}
              </div>
            ))}
            {pub.events.map((e) => (
              <div key={e.id} className="rounded-lg border border-stone-300 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-stone-500">Event</div>
                <div className="font-medium">{e.title}</div>
                <p className="text-sm text-stone-600">
                  {e.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
                {e.description && <p className="text-sm text-stone-600 mt-1">{e.description}</p>}
              </div>
            ))}
          </section>
        )}

        {pub.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pub.imageUrl} alt={pub.name} title={pub.imageCredit ?? undefined} className="w-full max-h-64 object-cover rounded-lg border border-stone-200" />
        )}

        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">
              On draft ({taps.filter((t) => t.confidence >= 1).length} confirmed{taps.some((t) => t.confidence < 1) ? `, ${taps.filter((t) => t.confidence < 1).length} likely` : ""})
            </h2>
            <span className="text-xs text-stone-500">Crowd-sourced · confirm or flag what you see</span>
          </div>
          <TapList taps={taps} signedIn={Boolean(user)} />
        </section>

        <AdSlot slot="pub-inline" />

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="font-semibold">Add a beer that&apos;s on draft here</h2>
          <p className="text-sm text-stone-600 mb-3">At the bar? Tell everyone what&apos;s pouring.</p>
          <AddTapForm pubId={pub.id} signedIn={Boolean(user)} />
        </section>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm space-y-1">
          <div className="font-medium">About this listing</div>
          <p className="text-stone-600">
            Location from {pub.source === "osm" ? "OpenStreetMap" : pub.source}. Tap list from drinkers
            {pub.claimedById ? " and the pub" : ""}.
          </p>
          {!pub.claimedById && (
            <p className="text-stone-600">
              Run this pub? <Link href="/for-pubs" className="underline">Claim it</Link> to post your own tap list, events and deals.
            </p>
          )}
        </div>
        <AdSlot slot="map-sidebar" />
      </aside>
    </main>
  );
}
