import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Chalkboard / drinks-menu OCR.
 *
 * A photo of a pub's beer board, pump clips, tap wall or printed drinks menu
 * goes in; a structured list of what's on draught comes out. Used by the pub
 * dashboard ("photograph your board") and by drinkers behind "Report a change".
 *
 * Model: claude-opus-5 with server-side refusal fallbacks enabled (a photo of a
 * bar should never trip a classifier, but if it does the request is re-run on
 * a fallback model inside the same call rather than failing).
 */

export const BoardReading = z.object({
  is_drinks_list: z.boolean().describe("true if the image actually shows a beer board, pump clips, tap wall or drinks menu"),
  venue_hint: z.string().nullable().describe("pub or brewery name if visible on the board, else null"),
  beers: z.array(
    z.object({
      name: z.string().describe("beer or cider name exactly as written, without the brewery unless it is part of the name"),
      brewery: z.string().nullable().describe("brewery if written or unambiguous from the name, else null"),
      style: z.string().nullable().describe("one of: lager, pale_ale, ipa, session_ipa, bitter, golden_ale, stout, porter, wheat, cider, fruit_cider, other; null if unknown"),
      abv: z.number().nullable().describe("ABV percentage as a number if written, else null"),
      price_pence: z.number().nullable().describe("pint price in pence if written (£5.20 -> 520), else null"),
      serving: z.string().nullable().describe("draught, keg, cask, bottle, can, or null. Only draught/keg/cask count as on tap."),
      confidence: z.number().describe("0 to 1: how sure you are this line is a real beer name read correctly"),
    }),
  ),
  notes: z.string().nullable().describe("anything the reader should know: blurry board, partially cropped, guest ales rotate, etc."),
});
export type BoardReadingT = z.infer<typeof BoardReading>;

const SYSTEM = `You read photographs of pub beer boards, pump clips, tap walls and drinks menus in the United Kingdom and list what is on draught.

Rules:
- Only list beers and ciders that are served on draught (cask or keg). Skip bottles, cans, wine, spirits, soft drinks and food. If a line's serving is unclear, keep it and set serving to null.
- Keep the name exactly as written on the board. Correct obvious OCR-style misreads only when the brand is unmistakable (e.g. "Guiness" -> "Guinness").
- Use UK conventions: prices are per pint in pounds; a price like "5.20" or "£5.20" is 520 pence. Half or two-thirds prices are not the pint price.
- If the image is not a drinks list at all, set is_drinks_list to false and return an empty beers array.
- Set confidence low for anything smudged, cropped, or guessed.`;

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function readBoard(image: { bytes: Buffer; mediaType: string }, opts: { pubName?: string } = {}): Promise<BoardReadingT> {
  if (!MEDIA_TYPES.has(image.mediaType)) throw new Error(`Unsupported image type ${image.mediaType}`);
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { format: zodOutputFormat(BoardReading) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: image.bytes.toString("base64") } },
          { type: "text", text: `List everything on draught in this photo${opts.pubName ? ` (taken at ${opts.pubName})` : ""}.` },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("The image couldn't be processed");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return BoardReading.parse(JSON.parse(text));
}
