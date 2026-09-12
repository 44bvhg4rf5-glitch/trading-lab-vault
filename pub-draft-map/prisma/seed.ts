/**
 * Seed a handful of real pubs (coordinates from OpenStreetMap) in Manchester
 * and Richmond upon Thames, plus a beer catalogue, so the app is usable
 * before running the full OSM import (scripts/import-osm.ts).
 *
 * Tap lists here are illustrative, not verified.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const breweries: Record<string, { country: string; beers: Array<[string, string, number]> }> = {
  Asahi: { country: "JP", beers: [["Asahi Super Dry", "lager", 5.0]] },
  Guinness: { country: "IE", beers: [["Guinness Draught", "stout", 4.2]] },
  "Cloudwater Brew Co": {
    country: "GB",
    beers: [
      ["Cloudwater Pale", "pale_ale", 4.0],
      ["Cloudwater IPA", "ipa", 6.5],
    ],
  },
  "Marble Beers": { country: "GB", beers: [["Marble Manchester Bitter", "bitter", 4.2]] },
  "Fuller's": { country: "GB", beers: [["London Pride", "bitter", 4.1]] },
  "Camden Town Brewery": { country: "GB", beers: [["Camden Hells", "lager", 4.6]] },
  BrewDog: { country: "GB", beers: [["Punk IPA", "ipa", 5.4]] },
  "Timothy Taylor": { country: "GB", beers: [["Landlord", "bitter", 4.3]] },
  Peroni: { country: "IT", beers: [["Peroni Nastro Azzurro", "lager", 5.1]] },
  Estrella: { country: "ES", beers: [["Estrella Damm", "lager", 4.6]] },
  Thornbridge: { country: "GB", beers: [["Jaipur", "ipa", 5.9]] },
  Aspall: { country: "GB", beers: [["Aspall Cyder", "cider", 5.5]] },
  Beavertown: {
    country: "GB",
    beers: [
      ["Gamma Ray", "pale_ale", 5.4],
      ["Neck Oil", "session_ipa", 4.3],
    ],
  },
  "Track Brewing": { country: "GB", beers: [["Sonoma", "pale_ale", 3.8]] },
};

const pubs = [
  // Manchester
  { osmId: "node/301245470", name: "The Marble Arch", kind: "pub", lat: 53.4894, lng: -2.2367, street: "73 Rochdale Road", city: "Manchester", postcode: "M4 4HY", taps: ["Marble Manchester Bitter", "Cloudwater Pale", "Guinness Draught"] },
  { osmId: "node/300521389", name: "Port Street Beer House", kind: "bar", lat: 53.4834, lng: -2.2322, street: "39-41 Port Street", city: "Manchester", postcode: "M1 2EQ", taps: ["Cloudwater IPA", "Jaipur", "Sonoma", "Asahi Super Dry"] },
  { osmId: "node/2201938731", name: "Cafe Beermoth", kind: "bar", lat: 53.4808, lng: -2.2400, street: "40a Spring Gardens", city: "Manchester", postcode: "M2 1EN", taps: ["Cloudwater Pale", "Gamma Ray", "Punk IPA"] },
  { osmId: "node/348271936", name: "The Briton's Protection", kind: "pub", lat: 53.4754, lng: -2.2465, street: "50 Great Bridgewater Street", city: "Manchester", postcode: "M1 5LE", taps: ["Landlord", "Guinness Draught", "Asahi Super Dry"] },
  { osmId: "node/271263862", name: "Peveril of the Peak", kind: "pub", lat: 53.4749, lng: -2.2447, street: "127 Great Bridgewater Street", city: "Manchester", postcode: "M1 5JQ", taps: ["Landlord", "Camden Hells"] },
  { osmId: "node/4285361289", name: "Cloudwater Barrel Store", kind: "brewery_tap", lat: 53.4761, lng: -2.2276, street: "Unit 9, Piccadilly Trading Estate", city: "Manchester", postcode: "M1 2NP", taps: ["Cloudwater Pale", "Cloudwater IPA"] },
  { osmId: "node/297830013", name: "The Castle Hotel", kind: "pub", lat: 53.4844, lng: -2.2354, street: "66 Oldham Street", city: "Manchester", postcode: "M4 1LE", taps: ["Marble Manchester Bitter", "Neck Oil", "Estrella Damm"] },
  { osmId: "node/1552118004", name: "Sandbar", kind: "bar", lat: 53.4692, lng: -2.2360, street: "120 Grosvenor Street", city: "Manchester", postcode: "M1 7HL", taps: ["Jaipur", "Peroni Nastro Azzurro", "Asahi Super Dry"] },
  // Richmond upon Thames
  { osmId: "node/25923811", name: "The White Cross", kind: "pub", lat: 51.4585, lng: -0.3069, street: "Riverside", city: "Richmond", postcode: "TW9 1TH", taps: ["London Pride", "Asahi Super Dry", "Guinness Draught", "Aspall Cyder"] },
  { osmId: "node/338122119", name: "The Roebuck", kind: "pub", lat: 51.4530, lng: -0.3016, street: "130 Richmond Hill", city: "Richmond", postcode: "TW10 6RN", taps: ["London Pride", "Landlord", "Camden Hells"] },
  { osmId: "node/25923812", name: "The Cricketers", kind: "pub", lat: 51.4602, lng: -0.3057, street: "The Green", city: "Richmond", postcode: "TW9 1LX", taps: ["Peroni Nastro Azzurro", "Guinness Draught", "Estrella Damm"] },
  { osmId: "node/2003567214", name: "The Tap Tavern", kind: "bar", lat: 51.4612, lng: -0.3042, street: "8 Princes Street", city: "Richmond", postcode: "TW9 1ED", taps: ["Gamma Ray", "Punk IPA", "Neck Oil", "Jaipur"] },
  { osmId: "node/25923813", name: "The Orange Tree", kind: "pub", lat: 51.4629, lng: -0.3024, street: "45 Kew Road", city: "Richmond", postcode: "TW9 2NQ", taps: ["London Pride", "Asahi Super Dry"] },
  { osmId: "node/25923814", name: "The Old Ship", kind: "pub", lat: 51.4604, lng: -0.3055, street: "3 King Street", city: "Richmond", postcode: "TW9 1ND", taps: ["London Pride", "Guinness Draught"] },
];

async function main() {
  const beerIds = new Map<string, string>();
  for (const [breweryName, info] of Object.entries(breweries)) {
    const brewery = await db.brewery.upsert({
      where: { name: breweryName },
      update: { country: info.country },
      create: { name: breweryName, country: info.country },
    });
    for (const [name, style, abv] of info.beers) {
      const beer = await db.beer.upsert({
        where: { name_breweryId: { name, breweryId: brewery.id } },
        update: { style, abv },
        create: { name, style, abv, breweryId: brewery.id },
      });
      beerIds.set(name, beer.id);
    }
  }

  const demoUser = await db.user.upsert({
    where: { email: "demo@draftmap.local" },
    update: {},
    create: { email: "demo@draftmap.local", displayName: "Demo Drinker" },
  });
  const ownerUser = await db.user.upsert({
    where: { email: "landlord@draftmap.local" },
    update: {},
    create: { email: "landlord@draftmap.local", displayName: "Demo Landlord", role: "PUB_OWNER" },
  });

  for (const p of pubs) {
    const { taps, ...data } = p;
    const pub = await db.pub.upsert({
      where: { osmId: p.osmId },
      update: data,
      create: data,
    });
    for (const beerName of taps) {
      const beerId = beerIds.get(beerName);
      if (!beerId) throw new Error(`Unknown beer in seed: ${beerName}`);
      await db.tapListing.upsert({
        where: { pubId_beerId: { pubId: pub.id, beerId } },
        update: { status: "ACTIVE", lastSeenAt: new Date() },
        create: { pubId: pub.id, beerId, reportedById: demoUser.id, pricePence: 500 + Math.floor(Math.random() * 250) },
      });
    }
  }

  // One claimed pub with an event and a deal, to demo the pub-side features.
  const whiteCross = await db.pub.findUnique({ where: { osmId: "node/25923811" } });
  if (whiteCross) {
    await db.pub.update({
      where: { id: whiteCross.id },
      data: { claimedById: ownerUser.id, claimedAt: new Date() },
    });
    await db.pubSubscription.upsert({
      where: { pubId: whiteCross.id },
      update: { plan: "PROMOTED" },
      create: { pubId: whiteCross.id, plan: "PROMOTED" },
    });
    if ((await db.event.count({ where: { pubId: whiteCross.id } })) === 0) {
      await db.event.create({
        data: {
          pubId: whiteCross.id,
          title: "Riverside Quiz Night",
          description: "Teams of up to six. £2 entry, bar tab prize.",
          startsAt: new Date(Date.now() + 3 * 86400_000),
          promoted: true,
        },
      });
      await db.deal.create({
        data: {
          pubId: whiteCross.id,
          title: "2-for-1 Asahi, Mon–Thu 5–7pm",
          validTo: new Date(Date.now() + 30 * 86400_000),
          promoted: true,
        },
      });
    }
  }

  // A few ratings so averages render.
  const listings = await db.tapListing.findMany({ take: 12 });
  for (const l of listings) {
    await db.beerRating.upsert({
      where: { userId_tapListingId: { userId: demoUser.id, tapListingId: l.id } },
      update: {},
      create: { userId: demoUser.id, tapListingId: l.id, beerId: l.beerId, score: 3 + Math.floor(Math.random() * 3) },
    });
  }

  console.log(`Seeded ${pubs.length} pubs, ${beerIds.size} beers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
