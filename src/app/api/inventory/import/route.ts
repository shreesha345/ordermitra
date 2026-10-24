import type { NextRequest } from "next/server";
import { upsertItems } from "@/lib/stock-edit";
import { extractInventory, type InventoryRow } from "@/lib/extract";
import { isSheet, mainTable, readTables, tableText, toIsoDate, type Table } from "@/lib/sheet";

type Field = keyof InventoryRow;

// Header words per field, most specific first. An exact header wins over one that only contains the word,
// and columns holding totals ("Product Value", "GST Amt", "Free Sch") never count as the field itself.
// The selling rate (what the retailer pays) is the price; MRP is kept separately.
const HEADERS: [Field, string[], RegExp?][] = [
  ["name", ["item description", "product name", "item name", "medicine name", "drug name", "product", "item", "medicine", "particulars", "description", "name"], /value|amt|amount|code|total|qty/],
  ["mrp", ["mrp", "max retail price"]],
  ["price", ["sale rate", "selling rate", "rate", "ptr", "pts", "selling price", "sale price", "price"], /disc|value|amt|gst|tax/],
  ["stock", ["closing stock", "closing", "stock", "qty", "quantity", "on hand", "balance", "available"], /free|value|amt/],
  ["unit", ["unit", "packing", "pack", "uom"]],
  ["batch", ["batch no", "batch"]],
  ["expiry", ["exp date", "expiry", "exp"]],
  ["hsn", ["hsn"]],
  ["gst_rate", ["gst %", "gst rate", "gst", "tax %", "tax"], /amt|amount|value/],
  ["schedule", ["schedule", "sch"], /free|scheme/],
  ["salt", ["composition", "salt", "generic", "molecule", "content"]],
  ["mfr", ["manufacturer", "mfg", "mkt", "company", "mfr"], /date/],
  ["rack", ["rack", "shelf", "bin", "location"]],
  ["box_qty", ["units per box", "per box", "box qty", "per case", "case qty", "per carton"]],
  ["aliases", ["alias", "also known", "other names"]],
];

const norm = (h: string) => h.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

/** Finds the header row in the first 15 rows and which column holds each field. */
function mapColumns(rows: string[][]) {
  let best: { row: number; cols: Partial<Record<Field, number>>; score: number } | null = null;
  rows.slice(0, 15).forEach((r, i) => {
    const head = r.map(norm);
    const cols: Partial<Record<Field, number>> = {};
    const used = new Set<number>();
    for (const [field, words, not] of HEADERS) {
      const ok = (h: string, j: number) => !used.has(j) && !!h && !not?.test(h);
      let idx = -1;
      for (const w of words) if ((idx = head.findIndex((h, j) => ok(h, j) && h === w)) >= 0) break;
      if (idx < 0) for (const w of words) if ((idx = head.findIndex((h, j) => ok(h, j) && h.includes(w))) >= 0) break;
      if (idx >= 0) {
        cols[field] = idx;
        used.add(idx);
      }
    }
    if (cols.price === undefined && cols.mrp !== undefined) cols.price = cols.mrp; // only MRP given
    const score = Object.keys(cols).length;
    if (cols.name !== undefined && score >= 2 && (!best || score > best.score)) best = { row: i, cols, score };
  });
  return best as { row: number; cols: Partial<Record<Field, number>> } | null;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && (s ?? "").trim() !== "" ? n : undefined;
};

function rowsFromTable(t: Table) {
  const map = mapColumns(t.rows);
  if (!map) return null;
  const get = (r: string[], f: Field) => (map.cols[f] === undefined ? undefined : r[map.cols[f]!]?.trim());
  const rows: InventoryRow[] = [];
  let skipped = 0;
  for (const r of t.rows.slice(map.row + 1)) {
    const name = get(r, "name") ?? "";
    // Blank lines, totals and section titles have no price and no stock
    if (!name || /^(sub\s*)?total|grand total/i.test(name) || (num(get(r, "price")) === undefined && num(get(r, "stock")) === undefined)) {
      skipped++;
      continue;
    }
    const sched = (get(r, "schedule") ?? "").toUpperCase().replace(/^SCH(EDULE)?\s*/, "");
    rows.push({
      name,
      unit: get(r, "unit") || undefined,
      price: num(get(r, "price")),
      stock: num(get(r, "stock")) === undefined ? undefined : Math.round(num(get(r, "stock"))!),
      aliases: get(r, "aliases") || undefined,
      salt: get(r, "salt") || undefined,
      batch: get(r, "batch") || undefined,
      expiry: toIsoDate(get(r, "expiry") ?? "") ?? undefined,
      hsn: get(r, "hsn")?.replace(/\.0+$/, "") || undefined,
      mrp: num(get(r, "mrp")),
      rack: get(r, "rack") || undefined,
      mfr: get(r, "mfr") || undefined,
      box_qty: num(get(r, "box_qty")),
      gst_rate: num(get(r, "gst_rate")),
      schedule: ["H", "H1", "X"].includes(sched) ? (sched as InventoryRow["schedule"]) : undefined,
    });
  }
  const header = t.rows[map.row];
  const columns = Object.fromEntries(Object.entries(map.cols).map(([f, i]) => [f, header[i]]));
  return { rows, skipped, headerRow: map.row + 1, columns };
}

const upsert = (rows: InventoryRow[]) => upsertItems(rows, "set");

export async function POST(req: NextRequest) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      // One medicine from the "Add medicine" form: its quantity is stock coming in
      const r = (await req.json()) as InventoryRow;
      if (!r.name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });
      return Response.json(upsertItems([{ ...r, name: r.name.trim() }], "add"));
    }
    const file = (await req.formData()).get("file");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "No file" }, { status: 400 });
    const mime = file.type.split(";")[0];
    const buf = Buffer.from(await file.arrayBuffer());

    if (!isSheet(file.name, mime)) {
      const rows = (await extractInventory({ media: { mime: mime || "application/pdf", data: buf } })).filter((r) => r.name?.trim());
      if (!rows.length) return Response.json({ error: "No medicines found in that file" }, { status: 422 });
      return Response.json({ ...upsert(rows), via: "ai", skipped: 0 });
    }

    const tables = await readTables(buf, file.name, mime);
    const table = mainTable(tables);
    if (!table?.rows.length) return Response.json({ error: "The spreadsheet is empty" }, { status: 422 });
    const read = rowsFromTable(table);
    if (read?.rows.length) return Response.json({ ...upsert(read.rows), via: "sheet", sheet: table.sheet, headerRow: read.headerRow, columns: read.columns, skipped: read.skipped });

    // Headers we do not recognise (or none): let the AI read the sheet as text.
    const rows = (await extractInventory({ text: tableText(table) })).filter((r) => r.name?.trim());
    if (!rows.length) {
      return Response.json({ error: "Could not find a medicine name column. Put a header row with “Name” (or “Product”), “Rate” and “Stock”." }, { status: 422 });
    }
    return Response.json({ ...upsert(rows), via: "ai", sheet: table.sheet, skipped: 0 });
  } catch (e) {
    console.error("inventory import failed", e);
    return Response.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 422 });
  }
}
