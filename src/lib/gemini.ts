import { GoogleGenAI, Type } from "@google/genai";
import { db, type Item } from "./db";
import { normLang, type Lang } from "./i18n";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export type Media = { mime: string; data: Buffer };

export type Understood = {
  language: Lang;
  transcript: string; // what the customer said, in their language
  translation: string; // same, in English
  items: { said: string; match: string | null; qty: number; needed: boolean }[];
};

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

function client() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

function parseJson<T>(raw: string | undefined): T {
  const s = (raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(s) as T;
}

// Gemini is held to this shape, so the reply always parses into an Understood.
const ORDER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING, enum: ["en", "hi", "kn", "ta", "te"] },
    transcript: { type: Type.STRING, description: "What the customer said, in their own language and script" },
    translation: { type: Type.STRING, description: "The same, in English" },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          said: { type: Type.STRING, description: "The medicine as the customer said it" },
          match: { type: Type.STRING, nullable: true, description: "Exact catalog name, or null" },
          qty: { type: Type.INTEGER },
          needed: { type: Type.BOOLEAN, description: "false if the customer does NOT want it" },
        },
        required: ["said", "match", "qty", "needed"],
        propertyOrdering: ["said", "match", "qty", "needed"],
      },
    },
  },
  required: ["language", "transcript", "translation", "items"],
  propertyOrdering: ["language", "transcript", "translation", "items"],
};

/** Safety net for when the model leaves an item unmatched: accept a name/alias hit only if it points at exactly one product. */
function uniqueLocalMatch(said: string, catalog: Pick<Item, "name" | "aliases">[]): string | null {
  const low = said.toLowerCase();
  const hits = new Set<string>();
  for (const c of catalog) {
    const keys = [c.name.split(" ")[0], ...c.aliases.split(",")].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3);
    if (keys.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low))) hits.add(c.name);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** Voice note, photo of a list, PDF or plain text -> structured order. */
export async function understandOrder(input: { media?: Media; text?: string }): Promise<Understood> {
  const catalog = db().prepare("SELECT name, aliases FROM items ORDER BY name").all() as Pick<Item, "name" | "aliases">[];
  if (!geminiEnabled()) return localUnderstand(input.text ?? "", catalog);

  const prompt = `You take medicine orders for an Indian pharmacy. The customer may speak or write in any language (Kannada, Hindi, Tamil, Telugu, English, or mixed).
1. Transcribe what the customer said, in their own language and script.
2. Translate it to English.
3. List every medicine they mention. "match" must be EXACTLY one name from the catalog below, or null only if nothing in the catalog is plausibly the same product (a different pack size or strength in the name is still a match, e.g. "Dolo 650" matches "Dolo 650 (15 tabs)"). Use brand, generic and local-language aliases. "qty" is how many units (default 1). Set "needed" to false for anything the customer says they do NOT want.
"language" is the language the customer spoke: en, hi, kn, ta or te. If the audio is silent or has no speech, return an empty transcript and no items.

Catalog:
${catalog.map((c) => `- ${c.name} (also: ${c.aliases})`).join("\n")}`;

  const parts: object[] = [{ text: prompt }];
  if (input.media) parts.push({ inlineData: { mimeType: input.media.mime, data: input.media.data.toString("base64") } });
  if (input.text) parts.push({ text: `Customer text: ${input.text}` });

  const res = await client().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", responseSchema: ORDER_SCHEMA },
  });
  console.log("gemini usage", res.usageMetadata); // tokens in/out, for tracking cost
  const out = parseJson<Understood>(res.text);
  const names = new Set(catalog.map((c) => c.name));
  return {
    language: normLang(out.language),
    transcript: out.transcript ?? "",
    translation: out.translation ?? out.transcript ?? "",
    items: (out.items ?? []).map((i) => ({
      said: i.said ?? "",
      match: i.match && names.has(i.match) ? i.match : uniqueLocalMatch(`${i.said ?? ""}`, catalog),
      qty: Math.max(1, Math.round(Number(i.qty) || 1)),
      needed: i.needed !== false,
    })),
  };
}

/** Rows of a medicine list in a photo / PDF -> inventory rows. */
export async function extractInventory(media: Media) {
  if (!geminiEnabled()) throw new Error("GEMINI_API_KEY is not set, so images and PDFs cannot be read.");
  const res = await client().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Read this medicine price list, stock sheet or distributor invoice. Return only JSON: {"items":[{"name":"","unit":"strip|bottle|sachet|can|unit","price":0,"stock":0,"aliases":""}]}. Use numbers for price and stock, and leave stock 0 if it is not shown.`,
          },
          { inlineData: { mimeType: media.mime, data: media.data.toString("base64") } },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });
  return parseJson<{ items: { name: string; unit?: string; price?: number; stock?: number; aliases?: string }[] }>(res.text).items ?? [];
}

// ---------- offline fallback (no API key): plain-text matching on names and aliases ----------

const NUM_WORDS: Record<string, number> = {
  one: 1, ondu: 1, ek: 1, oru: 1, okati: 1,
  two: 2, eradu: 2, do: 2, irandu: 2, rendu: 2,
  three: 3, mooru: 3, teen: 3, moonu: 3, moodu: 3,
  four: 4, naalku: 4, char: 4, naalu: 4,
  five: 5, aidu: 5, paanch: 5, ainthu: 5, aidhu: 5,
};
const NEG = /\b(not|no|don'?t|dont|beda|nahi|nahin|vendam|vaddu|illa)\b/i;

function localUnderstand(text: string, catalog: Pick<Item, "name" | "aliases">[]): Understood {
  const items: Understood["items"] = [];
  const segments = text.split(/[,.;\n]|\b(?:and|mattu|aur|and then|matthu|mariyu)\b/i).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const low = seg.toLowerCase();
    let best: { name: string; len: number } | null = null;
    for (const c of catalog) {
      const keys = [c.name.split(" ")[0], ...c.aliases.split(",")].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3);
      for (const k of keys) {
        if (low.includes(k) && (!best || k.length > best.len)) best = { name: c.name, len: k.length };
      }
    }
    if (!best) continue;
    const digit = low.match(/\d+/);
    const word = low.split(/\s+/).map((w) => NUM_WORDS[w]).find(Boolean);
    items.push({ said: seg, match: best.name, qty: digit ? Number(digit[0]) : (word ?? 1), needed: !NEG.test(low) });
  }
  return { language: "en", transcript: text, translation: text, items };
}
