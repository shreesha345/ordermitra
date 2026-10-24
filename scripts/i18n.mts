// Keeps the dashboard translations complete.
//
//   npm run i18n            list UI strings that are missing in any language
//   npm run i18n translate  translate the missing ones with the configured AI model, into src/locales/*.ts
//
// UI strings are the English text passed to t(...) in pages and components, plus the labels in a few lookup
// tables (status names, table headings, report sections). The English text is the key; {name} placeholders
// must come back unchanged, and a translation that drops or adds one is rejected.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LANGS = { hi: "Hindi", kn: "Kannada", ta: "Tamil", te: "Telugu" } as const;
type Lang = keyof typeof LANGS;

// Files whose strings show on the dashboard. lib/i18n.ts (WhatsApp messages) has its own five-language table.
const SOURCES = ["src/app", "src/components", "src/lib/batches.ts", "src/lib/insights.ts", "src/lib/integrations.ts", "src/lib/briefing.ts", "src/lib/demand.ts", "src/lib/gstr1.ts"];
// Values shown through t() that are not written as t("...") anywhere: confidence levels and selling units
const EXTRA = ["high", "medium", "low", "strip", "tablet", "capsule", "box", "case", "bottle", "sachet", "tube", "vial", "piece"];

const files = (p: string): string[] => {
  const abs = path.join(ROOT, p);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/route\.ts$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
};

const STR = /"((?:[^"\\\n]|\\.)*)"/g;
const unq = (s: string) => JSON.parse(`"${s}"`) as string;
const isText = (s: string) => /[A-Za-z]{2}/.test(s) && !/^[a-z_]+$/.test(s) && !/^[a-z]+[-:/.]/.test(s) && !/^(text|bg|border|flex|grid|px|py|rounded|font|size|mt|mb|inline)-/.test(s);

/** The first argument of each t(...) call, with the string literals in it (several for a ternary). */
function tCalls(src: string) {
  const out: string[] = [];
  for (const m of src.matchAll(/(?<![\w.])t\(/g)) {
    let i = m.index! + 2, depth = 0, quote = "";
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) break;
    }
    for (const s of src.slice(start, i).matchAll(STR)) out.push(unq(s[1]));
  }
  return out;
}

export function extract() {
  const keys = new Set<string>(EXTRA);
  for (const f of SOURCES.flatMap(files)) {
    const src = readFileSync(f, "utf8");
    for (const k of tCalls(src)) keys.add(k);
    // label / title / sub / advice / text fields in lookup tables
    for (const m of src.matchAll(/\b(?:label|title|sub|advice|text|name): "((?:[^"\\\n]|\\.)*)"/g)) keys.add(unq(m[1]));
    // table headings: ["Item", "Qty", ...].map(...)
    for (const m of src.matchAll(/\[((?:\s*"(?:[^"\\\n]|\\.)*",?)+)\s*\]\.map\(/g)) for (const s of m[1].matchAll(STR)) keys.add(unq(s[1]));
    // reasons.push("...") and checks in lib
    for (const m of src.matchAll(/reasons\.push\("((?:[^"\\\n]|\\.)*)"\)/g)) keys.add(unq(m[1]));
    // suggestion lists: const SUGGEST = ["...", ...]
    for (const m of src.matchAll(/const SUGGEST[^=]*=\s*\[([^\]]*)\]/g)) for (const x of m[1].matchAll(STR)) keys.add(unq(x[1]));
    // value maps: SOURCE, REASON, FIELD
    for (const m of src.matchAll(/const (?:SOURCE|REASON|FIELD)\b[^=]*=\s*\{([^}]*)\}/g)) for (const s of m[1].matchAll(/:\s*"((?:[^"\\\n]|\\.)*)"/g)) keys.add(unq(s[1]));
  }
  return [...keys].filter((k) => EXTRA.includes(k) || isText(k)).sort();
}

const localeFile = (l: Lang) => path.join(ROOT, "src/locales", `${l}.ts`);

function load(l: Lang): Record<string, string> {
  const src = readFileSync(localeFile(l), "utf8");
  const json = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
  return json.trim() === "{}" ? {} : (JSON.parse(json) as Record<string, string>);
}

function save(l: Lang, dict: Record<string, string>, keys: string[]) {
  const sorted = Object.fromEntries(keys.filter((k) => dict[k]).map((k) => [k, dict[k]]));
  writeFileSync(
    localeFile(l),
    `// ${LANGS[l]} for the dashboard. Keys are the English text. Fill gaps with: npm run i18n translate\n` +
      `const dict: Record<string, string> = ${JSON.stringify(sorted, null, 2)};\n\nexport default dict;\n`,
  );
}

const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

async function translate(l: Lang, missing: string[]) {
  const aiModule = "../src/lib/ai.ts"; // tsx runs the TypeScript source directly
  const { aiProvider, parseJson } = (await import(aiModule)) as typeof import("../src/lib/ai");
  const ai = aiProvider();
  if (!ai) throw new Error("No AI model is set up (AI_API_KEY and AI_MODEL in .env)");
  const out: Record<string, string> = {};
  for (let i = 0; i < missing.length; i += 60) {
    const batch = missing.slice(i, i + 60);
    const reply = await ai.generate({
      system: `You translate the user interface of a dashboard used by pharmaceutical wholesalers in India into ${LANGS[l]}.
Write natural, short ${LANGS[l]} as used in Indian business software, in its native script. Keep these in English (Latin script) as they are: GST, GSTIN, IGST, CGST, SGST, HSN, UQC, MRP, UPI, PDF, CSV, Excel, WhatsApp, AI, B2B, B2C, GSTR-1, GSTR-3B, Schedule H, invoice numbers, and anything in {braces}.
Keep every {placeholder} exactly as written. Keep symbols like ₹, %, ·, →, …, “ ” and emoji. Return a JSON object mapping each English string to its translation.`,
      messages: [{ role: "user", parts: [{ text: JSON.stringify(batch) }] }],
      json: true,
    });
    const got = parseJson<Record<string, string>>(reply.text);
    for (const k of batch) {
      const v = got[k];
      if (typeof v !== "string" || !v.trim()) console.warn(`  ${l}: no translation for "${k}"`);
      else if (vars(v) !== vars(k)) console.warn(`  ${l}: placeholders changed, skipped: "${k}" -> "${v}"`);
      else out[k] = v.trim();
    }
    console.log(`  ${l}: ${Math.min(i + 60, missing.length)}/${missing.length}`);
  }
  return out;
}

const keys = extract();
const mode = process.argv[2];
console.log(`${keys.length} UI strings`);
for (const l of Object.keys(LANGS) as Lang[]) {
  const dict = load(l);
  const missing = keys.filter((k) => !dict[k]);
  console.log(`${LANGS[l]}: ${missing.length} missing`);
  if (mode === "list") for (const k of missing) console.log(`  ${k}`);
  if (mode === "translate" && missing.length) save(l, { ...dict, ...(await translate(l, missing)) }, keys);
  else if (mode === "prune") save(l, dict, keys);
}
process.exit(0);
