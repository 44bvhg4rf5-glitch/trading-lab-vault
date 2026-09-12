/**
 * Ad placement. With NEXT_PUBLIC_ADSENSE_CLIENT set this renders an AdSense
 * unit; otherwise a labelled placeholder so layouts are designed with ads in
 * from day one (retrofitting ad slots is how you end up with layout shift).
 *
 * Slots: "map-sidebar" (300x250), "pub-inline" (responsive), "results-native".
 * Brewery-sponsored placements ("Sponsored: Asahi near you") should use the
 * results-native slot and be sold direct — see docs/monetisation.md.
 */
export function AdSlot({ slot, className = "" }: { slot: "map-sidebar" | "pub-inline" | "results-native"; className?: string }) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const sizes = { "map-sidebar": "min-h-[250px]", "pub-inline": "min-h-[100px]", "results-native": "min-h-[80px]" }[slot];

  if (client) {
    return (
      <div className={`${sizes} ${className}`}>
        <ins className="adsbygoogle block" data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
      </div>
    );
  }
  return (
    <div className={`${sizes} ${className} rounded border border-dashed border-stone-300 bg-stone-100 text-stone-400 text-xs flex items-center justify-center`}>
      Ad · {slot}
    </div>
  );
}
