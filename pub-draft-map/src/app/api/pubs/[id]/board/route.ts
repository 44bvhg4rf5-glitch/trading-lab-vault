import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { readBoard } from "@/lib/board-ocr";
import { upsertBeer } from "@/lib/beers";
import { normaliseName } from "@/lib/enrich";

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * POST /api/pubs/:id/board   multipart: file
 * Reads a photo of the pub's beer board and returns a proposed tap list.
 * Nothing is saved yet: the client shows the list and calls PUT to publish.
 */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  await requireUser();
  const { id } = await params;
  const pub = await db.pub.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!pub) return fail("Pub not found", 404);
  if (!process.env.ANTHROPIC_API_KEY) return fail("Board reading isn't configured on this server (ANTHROPIC_API_KEY)", 503);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("file is required");
  if (file.size > MAX_BYTES) return fail("Image too large (max 12MB)", 413);

  const reading = await readBoard({ bytes: Buffer.from(await file.arrayBuffer()), mediaType: file.type }, { pubName: pub.name });
  const proposed = reading.beers
    .filter((b) => b.confidence >= 0.4 && (b.serving == null || ["draught", "keg", "cask"].includes(b.serving)))
    .map((b) => ({ ...b, brewery: b.brewery ?? guessBrewery(b.name) }));
  return ok({ isDrinksList: reading.is_drinks_list, notes: reading.notes, proposed });
});

const publishSchema = z.object({
  beers: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        brewery: z.string().max(120).nullable(),
        style: z.string().max(40).nullable(),
        abv: z.number().min(0).max(80).nullable(),
        price_pence: z.number().int().min(0).max(5000).nullable(),
      }),
    )
    .min(1)
    .max(60),
  replace: z.boolean().default(false),
});

/**
 * PUT /api/pubs/:id/board   { beers, replace }
 * Publishes a board reading as the tap list. `replace` retires listings not
 * in the reading (use when the photo shows the whole board). A pub owner's
 * publish is source=pub_owner; a drinker's is source=user.
 */
export const PUT = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const pub = await db.pub.findUnique({ where: { id }, select: { id: true, claimedById: true } });
  if (!pub) return fail("Pub not found", 404);
  const body = await parseBody(req, publishSchema);
  const source = pub.claimedById === user.id || user.role === "ADMIN" ? "pub_owner" : "user";

  const kept = new Set<string>();
  for (const b of body.beers) {
    const beer = await upsertBeer({ name: b.name, breweryName: b.brewery ?? "Unknown brewery", style: b.style ?? undefined, abv: b.abv ?? undefined });
    kept.add(beer.id);
    await db.tapListing.upsert({
      where: { pubId_beerId: { pubId: id, beerId: beer.id } },
      update: { status: "ACTIVE", removedAt: null, lastSeenAt: new Date(), source, confidence: 1, inferredFrom: "board photo", pricePence: b.price_pence ?? undefined, confirmations: { increment: 1 } },
      create: { pubId: id, beerId: beer.id, source, confidence: 1, inferredFrom: "board photo", pricePence: b.price_pence, reportedById: user.id },
    });
  }
  let retired = 0;
  if (body.replace) {
    const r = await db.tapListing.updateMany({ where: { pubId: id, status: "ACTIVE", beerId: { notIn: [...kept] } }, data: { status: "REMOVED", removedAt: new Date() } });
    retired = r.count;
  }
  return ok({ published: kept.size, retired, source });
});

/** Cheap brewery guess for national brands the board won't spell out. */
function guessBrewery(name: string): string | null {
  const n = normaliseName(name);
  const table: Array<[RegExp, string]> = [
    [/guinness/, "Guinness"], [/carling/, "Molson Coors"], [/stella/, "AB InBev"], [/foster/, "Heineken UK"], [/amstel|moretti|cruzcampo|heineken|strongbow|inch|old mout/, "Heineken UK"],
    [/madri|coors|pravha|staropramen|blue moon/, "Molson Coors"], [/peroni|asahi/, "Asahi"], [/estrella/, "Damm"], [/san miguel|carlsberg|poretti|hobgoblin|wainwright|pedigree/, "Carlsberg Marston's"],
    [/camden/, "Camden Town Brewery"], [/neck oil|gamma ray|beavertown/, "Beavertown"], [/punk|brewdog|lost lager|hazy jane/, "BrewDog"], [/doom bar/, "Sharp's"], [/london pride|esb/, "Fuller's"],
    [/abbot|greene king|ice breaker|speckled hen|ruddles/, "Greene King"], [/landlord/, "Timothy Taylor"], [/thatchers/, "Thatchers"], [/aspall/, "Aspall"], [/kopparberg/, "Kopparberg"], [/magners/, "C&C"],
  ];
  for (const [re, brewery] of table) if (re.test(n)) return brewery;
  return null;
}
