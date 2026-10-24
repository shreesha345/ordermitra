import { aiProvider, parseJson, readerFor, type Media } from "./ai";

export type InventoryRow = {
  name: string;
  unit?: string;
  price?: number;
  stock?: number;
  aliases?: string;
  salt?: string;
  batch?: string;
  expiry?: string;
  hsn?: string;
  gst_rate?: number;
  schedule?: "" | "H" | "H1" | "X";
  mrp?: number;
  rack?: string;
  mfr?: string;
  box_qty?: number;
};

const PROMPT = `Read this medicine price list, stock sheet or distributor invoice. Return only JSON:
{"items":[{"name":"","unit":"strip|bottle|sachet|can|unit","price":0,"stock":0,"aliases":"","salt":"","batch":"","expiry":"YYYY-MM-DD","hsn":"","gst_rate":5,"schedule":""}]}
- "price" is the rate the retailer pays (PTR / rate), not MRP, unless only MRP is shown. Numbers only.
- "stock" is the quantity on hand; 0 if it is not shown.
- "salt" is the composition with strength, e.g. "Paracetamol 650mg", if shown.
- "schedule" is "H", "H1" or "X" if the sheet marks it, else "".
- Leave out totals, headings and blank lines. Omit fields that are not shown.`;

/** Rows of a medicine list in a photo, PDF or sheet text -> inventory rows. */
export async function extractInventory(input: { media?: Media; text?: string }): Promise<InventoryRow[]> {
  const ai = input.media ? readerFor(input.media.mime) : aiProvider();
  if (!ai) {
    throw new Error(
      input.media
        ? "No AI agent is set up that can read this kind of file (add AI_API_KEY and AI_MODEL), so use an Excel or CSV sheet."
        : "The column headers were not recognised and no AI agent is set up. Put a header row with “Name”, “Rate” and “Stock”.",
    );
  }
  const res = await ai.generate({
    system: PROMPT,
    messages: [{ role: "user", parts: [input.media ? { media: input.media } : { text: input.text ?? "" }] }],
    json: true,
  });
  const out = parseJson<{ items?: InventoryRow[] } | InventoryRow[]>(res.text);
  const items = Array.isArray(out) ? out : (out.items ?? []);
  return items.filter((i): i is InventoryRow => !!i && typeof i.name === "string" && !!i.name.trim());
}
