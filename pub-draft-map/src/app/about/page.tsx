import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@draftmap.example";

export default function AboutPage() {
  return (
    <main className="max-w-2xl w-full mx-auto p-4 space-y-4 text-stone-700">
      <h1 className="text-2xl font-semibold text-stone-900">About Draft Map</h1>
      <p>Draft Map shows what&apos;s on draught at pubs and bars across the UK, so you can find the beer you want, near where you are.</p>

      <h2 className="font-semibold text-stone-900 pt-2">Where the lists come from</h2>
      <p>
        Every pub&apos;s list comes from the best evidence we have, in this order: what the pub publishes on its own website or board, what its
        pub company publishes, the core range its brewery or chain puts in every pub, and what the pub or its drinkers have told us. A pub we
        can find nothing for is not shown until someone gives us something. Something wrong? Use <em>Report a change</em> on the pub page.
      </p>
      <p>
        Run a pub? <Link href="/for-pubs" className="underline">Claim it</Link>, free, and photograph your pumps: your list is live the same day.
      </p>

      <h2 className="font-semibold text-stone-900 pt-2">Data and attribution</h2>
      <p>
        Pub and bar locations are derived from <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ©
        OpenStreetMap contributors, available under the Open Database Licence. Map tiles are served by OpenStreetMap.
      </p>
      <p>
        Pub photographs come from <a className="underline" href="https://commons.wikimedia.org/">Wikimedia Commons</a> and{" "}
        <a className="underline" href="https://www.geograph.org.uk/">Geograph Britain and Ireland</a> under Creative Commons licences; the
        photographer and licence are credited on each photo. Beer names and prices are facts read from the pub&apos;s or its company&apos;s own
        published menus; we store no menu copy or images from those sites.
      </p>

      <h2 className="font-semibold text-stone-900 pt-2">Privacy</h2>
      <p>
        With an account we keep your email address, display name, ratings, and the photos you post. Without one we keep nothing about you.
        Searches are logged by beer and area, never by person, and are aggregated by area to help pubs choose what to stock. We do not sell
        or share individual data with anyone. To see or delete what we hold, email{" "}
        <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
      <p>
        Cookies: one session cookie when you sign in, nothing else of ours. Ad slots, where shown, may set their own; see the ad
        provider&apos;s policy.
      </p>

      <h2 className="font-semibold text-stone-900 pt-2">Contact</h2>
      <p>
        Pubs, breweries, corrections, press: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. Our crawler identifies itself
        as DraftMapBot and honours robots.txt; to opt a site out, email the same address.
      </p>
    </main>
  );
}
