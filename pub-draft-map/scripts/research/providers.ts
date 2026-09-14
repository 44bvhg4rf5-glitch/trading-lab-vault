/**
 * Search and reading providers for the unattended research worker.
 *
 * Every provider does the same two jobs behind the same two interfaces, so a
 * shard can be run on whichever free tier has allowance left today and the
 * results are indistinguishable:
 *
 *   SearchProvider  (pub) -> the pub's own website, or null
 *   Reader          (packet) -> a BoardReading: what is on draught, per the rules
 *
 * Providers (all through plain fetch, no SDK beyond the Anthropic one already
 * in the app):
 *   search: gemini   Gemini API with Google Search grounding   GEMINI_API_KEY
 *           brave    Brave Search API                          BRAVE_SEARCH_API_KEY
 *           none     skip pubs with no website on record
 *   read:   gemini   Gemini API, JSON output, images inline    GEMINI_API_KEY
 *           openai   OpenAI chat completions, JSON schema      OPENAI_API_KEY
 *           anthropic the app's own board reader (Claude)      ANTHROPIC_API_KEY
 *           none     catalogue matching only (no model)
 *
 * Rate limits: each call is throttled per provider and retried with backoff
 * on 429 / 5xx. A 429 that still fails after the retries is treated as the
 * day's allowance being spent: QuotaExhausted is thrown and the worker exits
 * with code 3 so a cron job can resume tomorrow from the results file.
 */
import { readFileSync } from "node:fs";
import { BoardReading, type BoardReadingT } from "../../src/lib/board-ocr";
import { pickOwnSite, searchWebsite as braveSearch } from "./lib";
import type { Packet } from "./packet";

export class QuotaExhausted extends Error {}

export type SearchProvider = (pub: { name: string; city?: string | null; postcode?: string | null; street?: string | null }) => Promise<string | null>;
export type Reader = (packet: Packet) => Promise<BoardReadingT | null>;

// ---------------------------------------------------------------------------
// Shared: the reading rules every model gets, and the JSON schema they fill in
// ---------------------------------------------------------------------------

export const READING_RULES = `You are reading a UK pub's own website (page text, PDF text and photos the site labels as menus or boards) to list what that pub serves ON DRAUGHT.

Rules:
- Only beers and ciders served on draught: keg, cask, tap, hand pump, "on draught", or listed with pint / half-pint prices. Bottles, cans, wine, spirits, cocktails, soft drinks and alcohol-free lines are not draught. If a line's serving is unclear, keep it and set serving to null.
- Countries, regions, fruit flavours, category headings ("Lagers", "Cask ales", "4.5%") and marketing copy ("a great selection of ales") are not beers. If the site names no draught beer, return is_drinks_list=false and an empty list.
- Use the beer's proper name as the brewery spells it (Guinness, Madrí Excepcional, Camden Hells, Beavertown Neck Oil, London Pride, Doom Bar, Birra Moretti, Cruzcampo, Peroni Nastro Azzurro, Asahi Super Dry, Estrella Damm, Stella Artois, Carling, Foster's, Heineken, Amstel, Aspall, Thatchers Gold, Inch's, Old Mout, Rekorderlig, Timothy Taylor's Landlord). Fix obvious typos.
- abv only if stated or well known for that beer; price_pence only if a pint price is shown (£6.50 -> 650).
- confidence 0 to 1: how sure you are this line is a real draught beer at this pub. Anything guessed or from generic copy gets below 0.5.
- If the text is clearly another pub with the same name (different town), return is_drinks_list=false and say so in notes.`;

/** The BoardReading shape as a JSON schema. Gemini takes OpenAPI-style nullable; OpenAI strict mode takes type arrays and additionalProperties=false. */
export function readingSchema(flavour: "gemini" | "openai") {
  const nullable = (t: string) => (flavour === "gemini" ? { type: t, nullable: true } : { type: [t, "null"] });
  const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), ...(flavour === "openai" ? { additionalProperties: false } : {}) });
  return obj({
    is_drinks_list: { type: "boolean" },
    venue_hint: nullable("string"),
    beers: { type: "array", items: obj({ name: { type: "string" }, brewery: nullable("string"), style: nullable("string"), abv: nullable("number"), price_pence: nullable("number"), serving: nullable("string"), confidence: { type: "number" } }) },
    notes: nullable("string"),
  });
}

/** What a reader gets to look at: the packet's text, labelled by source, capped. */
export function packetText(packet: Packet, cap = 14_000): string {
  const parts: string[] = [`Pub: ${packet.pub.name}${packet.pub.city ? ", " + packet.pub.city : ""}${packet.pub.postcode ? " " + packet.pub.postcode : ""}\nWebsite: ${packet.website}`];
  for (const p of packet.drinksPages) parts.push(`--- page ${p.url}\n${p.excerpt}`);
  for (const p of packet.pdfs) parts.push(`--- pdf ${p.url}\n${p.excerpt}`);
  if (packet.embeds.length) parts.push(`(embedded menus not readable: ${packet.embeds.join(", ")})`);
  return parts.join("\n\n").slice(0, cap);
}

function imageParts(packet: Packet) {
  return packet.images.slice(0, 4).flatMap((img) => {
    try {
      const bytes = readFileSync(img.file);
      const ext = img.file.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return [{ mime, b64: bytes.toString("base64"), url: img.url }];
    } catch { return []; }
  });
}

// ---------------------------------------------------------------------------
// Throttled, retried JSON calls
// ---------------------------------------------------------------------------

const lastCall = new Map<string, number>();
export async function callJson(provider: string, url: string, init: RequestInit, opts: { minIntervalMs?: number } = {}): Promise<unknown> {
  const gap = (opts.minIntervalMs ?? 4_000) - (Date.now() - (lastCall.get(provider) ?? 0));
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  for (let attempt = 1; attempt <= 4; attempt++) {
    lastCall.set(provider, Date.now());
    let res: Response;
    try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) }); }
    catch (e) { if (attempt === 4) throw e; await new Promise((r) => setTimeout(r, 5_000 * attempt)); continue; }
    if (res.ok) return res.json();
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 4 || /quota|RESOURCE_EXHAUSTED|insufficient_quota|billing/i.test(body)) throw new QuotaExhausted(`${provider}: ${res.status} ${body.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
      continue;
    }
    throw new Error(`${provider}: ${res.status} ${body.slice(0, 300)}`);
  }
  throw new Error(`${provider}: gave up`);
}

// ---------------------------------------------------------------------------
// Gemini (search grounding + JSON reading)
// ---------------------------------------------------------------------------

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const geminiUrl = () => `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const geminiHeaders = () => ({ "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" });

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[] };

/** Grounding links are redirectors; follow one hop to learn the real host. */
async function resolveRedirect(uri: string): Promise<string> {
  try {
    const res = await fetch(uri, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    return res.headers.get("location") ?? uri;
  } catch { return uri; }
}

export const geminiSearch: SearchProvider = async (pub) => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const where = [pub.city, pub.postcode].filter(Boolean).join(" ");
  const prompt = `Find the official website of the pub "${pub.name}"${where ? ` in ${where}, UK` : " in the UK"}. Reply with the website URL on the first line (the pub's own domain, or its page on its pub company's site), or the single word NONE if the pub has no website of its own. Never give Facebook, Instagram, TripAdvisor, WhatPub, CAMRA, Untappd or directory pages.`;
  const json = (await callJson("gemini", geminiUrl(), { method: "POST", headers: geminiHeaders(), body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }) }, { minIntervalMs: 4_500 })) as GeminiResponse;
  const cand = json.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("\n") ?? "";
  const results: { url: string; title?: string | null }[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)"'<>]+/g)) results.push({ url: m[0], title: pub.name });
  for (const c of (cand?.groundingMetadata?.groundingChunks ?? []).slice(0, 8)) {
    if (!c.web?.uri) continue;
    results.push({ url: await resolveRedirect(c.web.uri), title: c.web.title ?? null });
  }
  return pickOwnSite(results, pub);
};

export const geminiReader: Reader = async (packet) => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const parts: unknown[] = [{ text: READING_RULES + "\n\nRespond with JSON only.\n\n" + packetText(packet) }];
  for (const img of imageParts(packet)) parts.push({ text: `--- photo ${img.url}` }, { inlineData: { mimeType: img.mime, data: img.b64 } });
  const json = (await callJson("gemini", geminiUrl(), { method: "POST", headers: geminiHeaders(), body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", responseSchema: readingSchema("gemini"), temperature: 0 } }) }, { minIntervalMs: 4_500 })) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return parseReading(text);
};

// ---------------------------------------------------------------------------
// OpenAI (reading only)
// ---------------------------------------------------------------------------

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export const openaiReader: Reader = async (packet) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const content: unknown[] = [{ type: "text", text: packetText(packet) }];
  for (const img of imageParts(packet)) content.push({ type: "text", text: `--- photo ${img.url}` }, { type: "image_url", image_url: { url: `data:${img.mime};base64,${img.b64}` } });
  const json = (await callJson("openai", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0, messages: [{ role: "system", content: READING_RULES }, { role: "user", content }], response_format: { type: "json_schema", json_schema: { name: "board_reading", strict: true, schema: readingSchema("openai") } } }),
  }, { minIntervalMs: 1_500 })) as { choices?: { message?: { content?: string } }[] };
  return parseReading(json.choices?.[0]?.message?.content ?? "");
};

// ---------------------------------------------------------------------------
// Anthropic (the app's own board reader)
// ---------------------------------------------------------------------------

export const anthropicReader: Reader = async (packet) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const { readBoardText, readBoard } = await import("../../src/lib/board-ocr");
  const merged: BoardReadingT = { is_drinks_list: false, venue_hint: null, beers: [], notes: null };
  const text = packetText(packet);
  if (packet.drinksPages.length || packet.pdfs.length) {
    const r = await readBoardText(READING_RULES + "\n\n" + text, { pubName: packet.pub.name });
    merged.is_drinks_list ||= r.is_drinks_list;
    merged.beers.push(...r.beers);
    merged.notes = r.notes;
  }
  for (const img of imageParts(packet)) {
    const r = await readBoard({ bytes: Buffer.from(img.b64, "base64"), mediaType: img.mime }, { pubName: packet.pub.name });
    merged.is_drinks_list ||= r.is_drinks_list;
    merged.beers.push(...r.beers);
  }
  return merged;
};

function parseReading(text: string): BoardReadingT | null {
  try {
    const raw = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
    const parsed = BoardReading.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SEARCH: Record<string, SearchProvider | null> = { gemini: geminiSearch, brave: braveSearch, none: null };
export const READ: Record<string, Reader | null> = { gemini: geminiReader, openai: openaiReader, anthropic: anthropicReader, none: null };
