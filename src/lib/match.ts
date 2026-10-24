import { asciiDigits, unitIn, type Unit } from "./units";
import { refreshExpiry } from "./batches";
import { db, type Item } from "./db";

// Matching what a retailer said ("dolo", "bukhar ki goli", "pan 40") to the catalogue, without AI.
// The AI agent matches on its own; this backs it up, and is the whole matcher when no AI key is set.

export type CatalogueEntry = Pick<Item, "id" | "name" | "aliases" | "salt" | "price" | "unit" | "stock" | "reserved" | "rx" | "schedule" | "gst_rate">;

export const catalogue = () => (refreshExpiry(), db()).prepare("SELECT id, name, aliases, salt, price, unit, stock, reserved, rx, schedule, gst_rate FROM items ORDER BY name").all() as CatalogueEntry[];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keysOf = (c: Pick<Item, "name" | "aliases">) =>
  [c.name.split(" ")[0], c.name.replace(/\s*\(.*\)$/, ""), ...c.aliases.split(",")].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3);

function scored(text: string, list: CatalogueEntry[]) {
  const low = text.toLowerCase();
  return list
    .map((c) => ({ c, len: Math.max(0, ...keysOf(c).filter((k) => new RegExp(`\\b${esc(k)}\\b`).test(low)).map((k) => k.length)) }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len);
}

/** Catalogue items whose name or alias appears in the text, best (longest key) first. */
export const search = (text: string, list = catalogue()) => scored(text, list).map((x) => x.c);

/** An exact catalogue name, or the one item the words point at most clearly; null when it is ambiguous or unknown. */
export function resolve(match: string | null | undefined, said: string, list = catalogue()): CatalogueEntry | null {
  const exact = match && list.find((c) => c.name.toLowerCase() === match.trim().toLowerCase());
  if (exact) return exact;
  const hits = scored(`${match ?? ""} ${said}`, list);
  return hits.length && (hits.length === 1 || hits[0].len > hits[1].len) ? hits[0].c : null;
}

/** Same composition and strength, in stock: what a pharmacist may give instead. */
export function substitutes(item: Pick<Item, "id" | "salt">, list = catalogue()) {
  const salt = item.salt.trim().toLowerCase();
  if (!salt) return [];
  return list
    .filter((c) => c.id !== item.id && c.salt.trim().toLowerCase() === salt && c.stock - c.reserved > 0)
    .sort((a, b) => b.stock - b.reserved - (a.stock - a.reserved));
}

/** Items with this composition, whatever the brand. For medicines we do not stock by name. */
export const bySalt = (salt: string, list = catalogue()) => {
  const words = salt.toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 3);
  return list.filter((c) => c.salt && words.length && words.every((w) => c.salt.toLowerCase().includes(w)));
};

// ---------- offline order reading: plain-text matching on names and aliases ----------

const NUM_WORDS: Record<string, number> = {
  one: 1, ondu: 1, ek: 1, oru: 1, okati: 1,
  two: 2, eradu: 2, do: 2, irandu: 2, rendu: 2,
  three: 3, mooru: 3, teen: 3, moonu: 3, moodu: 3,
  four: 4, naalku: 4, char: 4, naalu: 4,
  five: 5, aidu: 5, paanch: 5, ainthu: 5, aidhu: 5,
};
const NEG = /\b(not|no|don'?t|dont|beda|nahi|nahin|vendam|vaddu|illa)\b/i;

export type OrderItem = { said: string; match: string | null; qty: number; unit?: Unit | null; needed: boolean };

/** "Dolo 650 100 strips, pan 40 20 and no crocin" -> items. */
export function parseOrderText(text: string, list = catalogue()): OrderItem[] {
  const items: OrderItem[] = [];
  text = asciiDigits(text);
  const segments = text.split(/[,.;\n]|\b(?:and|mattu|aur|and then|matthu|mariyu)\b/i).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const best = search(seg, list)[0];
    if (!best) continue;
    const low = seg.toLowerCase();
    // "Dolo 650 100 strips": the 650 is part of the name, so look for the quantity in the other words
    const nameWords = new Set(best.name.toLowerCase().split(/[\s()]+/));
    const digit = low.split(/\s+/).filter((w) => !nameWords.has(w)).join(" ").match(/\d+/);
    const word = low.split(/\s+/).map((w) => NUM_WORDS[w]).find(Boolean);
    // The unit is the word right after the quantity ("45 tabs", "3 dabba"), else any unit word not in the name
    const after = digit ? new RegExp(String.raw`(?:^|\s)${digit[0]}\s*([^\s\d,]+)`).exec(low)?.[1] : undefined;
    const unit = (after && unitIn(after)) || unitIn(low.split(/\s+/).filter((w) => !nameWords.has(w)).join(" "));
    items.push({ said: seg, match: best.name, qty: digit ? Number(digit[0]) : (word ?? 1), unit, needed: !NEG.test(low) });
  }
  return items;
}
