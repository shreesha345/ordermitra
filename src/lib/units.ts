import type { Item } from "./db";

// Quantities as retailers write them: "10 patta", "2 dabba", "५० गोली", "1 ctn", "60 tabs". The AI agent maps
// the unit word (any language) to one of UNITS; the offline reader uses UNIT_WORDS. Then the quantity is turned
// into the product's selling unit (strips, bottles...) where the pack size says how.

export const UNITS = ["strip", "tablet", "capsule", "box", "case", "bottle", "sachet", "tube", "vial", "piece"] as const;
export type Unit = (typeof UNITS)[number];

/** Unit words in English, Hinglish and Indian scripts -> unit. */
const UNIT_WORDS: Record<string, Unit> = {
  strip: "strip", strips: "strip", patta: "strip", patti: "strip", pattas: "strip", pata: "strip", पत्ता: "strip", पत्ते: "strip", पत्ती: "strip", स्ट्रिप: "strip",
  ಸ್ಟ್ರಿಪ್: "strip", ಪಟ್ಟಿ: "strip", ஸ்ட்ரிப்: "strip", அட்டை: "strip", స్ట్రిప్: "strip", అట్ట: "strip",
  tab: "tablet", tabs: "tablet", tablet: "tablet", tablets: "tablet", goli: "tablet", golis: "tablet", गोली: "tablet", गोलियां: "tablet", टैबलेट: "tablet",
  ಮಾತ್ರೆ: "tablet", ಮಾತ್ರೆಗಳು: "tablet", மாத்திரை: "tablet", மாத்திரைகள்: "tablet", మాత్ర: "tablet", మాత్రలు: "tablet", బిళ్ళ: "tablet",
  cap: "capsule", caps: "capsule", capsule: "capsule", capsules: "capsule", कैप्सूल: "capsule",
  box: "box", boxes: "box", bx: "box", dabba: "box", dabbe: "box", dibba: "box", डब्बा: "box", डिब्बा: "box", डब्बे: "box", ಡಬ್ಬ: "box", ಬಾಕ್ಸ್: "box", பெட்டி: "box", டப்பா: "box", డబ్బా: "box", బాక్స్: "box",
  case: "case", cases: "case", carton: "case", cartons: "case", ctn: "case", ctns: "case", peti: "case", पेटी: "case",
  bottle: "bottle", bottles: "bottle", btl: "bottle", botal: "bottle", बोतल: "bottle", ಬಾಟಲ್: "bottle", ಬಾಟಲಿ: "bottle", பாட்டில்: "bottle", సీసా: "bottle", బాటిల్: "bottle",
  sachet: "sachet", sachets: "sachet", pkt: "sachet", packet: "sachet", packets: "sachet", पैकेट: "sachet", पाउच: "sachet",
  tube: "tube", tubes: "tube", vial: "vial", vials: "vial",
  pc: "piece", pcs: "piece", piece: "piece", pieces: "piece", nos: "piece", no: "piece", unit: "piece", units: "piece",
};

/** Devanagari, Kannada, Tamil, Telugu (and other Indic) digits -> 0-9. */
export function asciiDigits(s: string) {
  return s.replace(/[०-९೦-೯௦-௯౦-౯০-৯૦-૯੦-੯]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code - ((code & 0xfff0) + 6)); // every block's zero sits at xxx6
  });
}

/** The unit word in a piece of text, if any. */
export function unitIn(text: string): Unit | null {
  for (const w of text.toLowerCase().split(/[\s,.:;()\-/]+/)) {
    const u = UNIT_WORDS[w] ?? UNIT_WORDS[w.replace(/^\d+/, "")]; // "10strips"
    if (u) return u;
  }
  return null;
}

export const asUnit = (v: unknown): Unit | null => (typeof v === "string" && (UNITS as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as Unit) : unitIn(String(v ?? "")));

/** What one selling unit of this product is: strip, bottle, tube... */
export function sellingUnit(item: Pick<Item, "name" | "unit">): Unit | null {
  const u = `${item.unit} ${item.name}`.toLowerCase();
  if (/strip|\d+\s*'?\s*s\b|tabs?\b|caps?\b|tablets?|capsules?/.test(u)) return "strip";
  if (/bottle|syp|syrup|\bml\b|\d+ml/.test(u)) return "bottle";
  return unitIn(u);
}

/** Tablets or capsules per strip, from "Dolo 650 (15 tabs)" or a pack of "15'S". */
export function perStrip(item: Pick<Item, "name" | "unit">) {
  const m = /(\d+)\s*(?:tabs?|caps?|tablets?|capsules?)\b/i.exec(item.name) ?? /^(\d+)\s*'?\s*s$/i.exec(item.unit.trim()) ?? /(\d+)\s*(?:tabs?|caps?)\b/i.exec(item.unit);
  return m ? Number(m[1]) : 0;
}

/**
 * The quantity in the product's selling unit. `note` is what the retailer wrote, shown back to them when it
 * was converted or could not be; `unclear` means we could not convert and they should check it.
 */
export function toSellingQty(item: Pick<Item, "name" | "unit" | "box_qty">, qty: number, unit: Unit | null): { qty: number; note: string; unclear: boolean } {
  const sell = sellingUnit(item);
  const wrote = `${qty} ${unit ?? ""}`.trim();
  if (!unit || unit === sell || unit === "piece") return { qty, note: "", unclear: false };
  if ((unit === "tablet" || unit === "capsule") && sell === "strip" && perStrip(item)) {
    return { qty: Math.max(1, Math.ceil(qty / perStrip(item))), note: wrote, unclear: false };
  }
  if ((unit === "box" || unit === "case") && item.box_qty > 0) return { qty: qty * item.box_qty, note: wrote, unclear: false };
  return { qty, note: wrote, unclear: true };
}
