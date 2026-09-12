import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { planOf } from "@/lib/plans";
import { daysAgo } from "@/lib/time";
import { PubDashboard } from "@/components/PubDashboard";

export default async function PubDashboardPage({ params }: { params: Promise<{ pubId: string }> }) {
  const { pubId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/pub/${pubId}`);

  const pub = await db.pub.findUnique({
    where: { id: pubId },
    include: {
      subscription: true,
      events: { orderBy: { startsAt: "desc" }, take: 20 },
      deals: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { tapListings: { where: { status: "ACTIVE" } } } },
    },
  });
  if (!pub) notFound();
  if (pub.claimedById !== user.id && user.role !== "ADMIN") redirect(`/pub/${pubId}`);

  const since = daysAgo(30);
  const [searchesNearby, ratingsCount] = await Promise.all([
    db.searchLog.count({ where: { createdAt: { gte: since }, place: pub.city ? { contains: pub.city } : undefined } }),
    db.beerRating.count({ where: { tapListing: { pubId } } }),
  ]);

  return (
    <main className="max-w-4xl w-full mx-auto p-4 space-y-6">
      <header>
        <Link href={`/pub/${pub.id}`} className="text-sm text-stone-500 hover:underline">← Public page</Link>
        <h1 className="text-2xl font-semibold mt-1">Manage {pub.name}</h1>
        <p className="text-sm text-stone-600">
          {pub._count.tapListings} beers listed · {ratingsCount} ratings · {searchesNearby} beer searches in {pub.city ?? "your area"} in the last 30 days
        </p>
      </header>
      <PubDashboard
        pubId={pub.id}
        city={pub.city}
        plan={planOf(pub.subscription?.plan)}
        events={pub.events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), promoted: e.promoted }))}
        deals={pub.deals.map((d) => ({ id: d.id, title: d.title, validTo: d.validTo?.toISOString() ?? null, promoted: d.promoted }))}
      />
    </main>
  );
}
