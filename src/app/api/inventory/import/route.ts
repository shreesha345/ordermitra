import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { db, tx, type Item } from "@/lib/db";
import { extractInventory } from "@/lib/gemini";

type Row = { name: string; unit?: string; price?: number; stock?: number; aliases?: string };

const pick = (h: string[], ...names: string[]) => h.findIndex((x) => names.some((n) => x.includes(n)));

/** CSV or Excel -> rows, by matching header names loosely. */
async function readSheet(file: File): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  const buf = Buffer.from(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) await wb.csv.read(Readable.from(buf));
  else await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const cell = (v: ExcelJS.CellValue): string => (v == null ? "" : typeof v === "object" && "result" in v ? String(v.result ?? "") : String(v));
  const head = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => cell(v).toLowerCase().trim());
  const col = {
    name: pick(head, "name", "item", "medicine", "product", "drug"),
    unit: pick(head, "unit", "pack"),
    price: pick(head, "price", "rate", "mrp"),
    stock: pick(head, "stock", "qty", "quantity", "on hand"),
    aliases: pick(head, "alias", "also", "generic", "other"),
  };
  if (col.name < 0) throw new Error("Could not find a medicine name column. Name one column “Name” or “Medicine”.");
  const rows: Row[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = r.values as ExcelJS.CellValue[];
    const name = cell(v[col.name]).trim();
    if (!name) return;
    rows.push({
      name,
      unit: col.unit > 0 ? cell(v[col.unit]).trim() || undefined : undefined,
      price: col.price > 0 ? Number(cell(v[col.price]).replace(/[^\d.]/g, "")) || 0 : undefined,
      stock: col.stock > 0 ? Math.round(Number(cell(v[col.stock]).replace(/[^\d.-]/g, "")) || 0) : undefined,
      aliases: col.aliases > 0 ? cell(v[col.aliases]).trim() : undefined,
    });
  });
  return rows;
}

function upsert(rows: Row[]) {
  const d = db();
  let added = 0;
  let updated = 0;
  tx(() => {
    for (const r of rows) {
      const cur = d.prepare("SELECT * FROM items WHERE name = ? COLLATE NOCASE").get(r.name) as Item | undefined;
      if (!cur) {
        const res = d
          .prepare("INSERT INTO items (name, aliases, unit, price, stock) VALUES (?,?,?,?,?)")
          .run(r.name, r.aliases ?? "", r.unit || "unit", r.price ?? 0, r.stock ?? 0);
        if (r.stock) d.prepare("INSERT INTO stock_movements (item_id, change, kind, at) VALUES (?,?,?,?)").run(Number(res.lastInsertRowid), r.stock, "import", Date.now());
        added++;
      } else {
        const stock = r.stock ?? cur.stock;
        d.prepare("UPDATE items SET unit = ?, price = ?, stock = ?, aliases = ? WHERE id = ?").run(
          r.unit || cur.unit,
          r.price ?? cur.price,
          stock,
          r.aliases || cur.aliases,
          cur.id,
        );
        if (stock !== cur.stock) d.prepare("INSERT INTO stock_movements (item_id, change, kind, at) VALUES (?,?,?,?)").run(cur.id, stock - cur.stock, "import", Date.now());
        updated++;
      }
    }
  });
  return { added, updated };
}

export async function POST(req: NextRequest) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const r = (await req.json()) as Row;
      if (!r.name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });
      return Response.json(upsert([{ ...r, name: r.name.trim() }]));
    }
    const file = (await req.formData()).get("file") as File | null;
    if (!file) return Response.json({ error: "No file" }, { status: 400 });
    const mime = file.type.split(";")[0];
    const isSheet = /\.(csv|xlsx)$/i.test(file.name);
    const rows = isSheet
      ? await readSheet(file)
      : await extractInventory({ mime: mime || "application/pdf", data: Buffer.from(await file.arrayBuffer()) });
    if (!rows.length) return Response.json({ error: "No medicines found in that file" }, { status: 422 });
    return Response.json(upsert(rows));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 422 });
  }
}
