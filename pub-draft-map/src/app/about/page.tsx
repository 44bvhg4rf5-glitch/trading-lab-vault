import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <main className="max-w-2xl w-full mx-auto p-4 space-y-4 text-stone-700">
      <h1 className="text-2xl font-semibold text-stone-900">About Draft Map</h1>
      <p>Draft Map shows what&apos;s on draft at pubs and bars across the UK, so you can find the beer you want, near where you are.</p>
      <p>
        Tap lists are crowd-sourced by drinkers and, where a pub has claimed its listing, by the pub itself. Every listing shows when it was
        last confirmed. If a beer&apos;s gone, tell us and it disappears.
      </p>
      <h2 className="font-semibold text-stone-900 pt-2">Data</h2>
      <p>
        Pub and bar locations are derived from <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ©
        OpenStreetMap contributors, available under the Open Database Licence. Map tiles are served by OpenStreetMap.
      </p>
      <p>
        Search and rating activity is aggregated by area to help pubs choose what to stock. We never sell individual user data. See our
        privacy policy for the detail.
      </p>
    </main>
  );
}
