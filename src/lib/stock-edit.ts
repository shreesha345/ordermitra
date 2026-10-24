import { consume, syncItem } from "./batches";
import { db, tx, type Item } from "./db";
import type { InventoryRow } from "./extract";

// Adding and updating medicines, from a stock sheet, the "Add medicine" form or the dashboard assistant.
//
// mode "set": the row is a stock count (a sheet), so quantities replace what is there.
// mode "add": the row is stock coming in (or going out, when negative), so quantities are added.
// Fields that are not given keep their current value; a new medicine gets sensible defaults.

export type StockMode = "set" | "add";
export type UpsertResult = { added: number; updated: number; batches: number; names: string[]; problems: string[] };

// Limits for anything typed, read from a file or proposed by the AI. A value outside them is not saved.
const MAX_QTY = 100_000;
const MAX_PRICE = 1_00_000;
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

/** Strips control characters and markup, squeezes spaces, and caps the length. */
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>{}`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : undefined;
const number = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** One row made safe to save. Fields that fail a check are dropped, with the reason. */
export function cleanRow(r: InventoryRow): { row: InventoryRow | null; problems: string[] } {
  const problems: string[] = [];
  const name = text(r.name, 120);
  if (!name || !/\p{L}/u.test(name)) return { row: null, problems: [`Skipped a row without a proper medicine name`] };
  const row: InventoryRow = { name };
  const keep = <K extends keyof InventoryRow>(k: K, v: InventoryRow[K] | undefined, why: string) => {
    if (v !== undefined) row[k] = v;
    else if (r[k] !== undefined && r[k] !== "") problems.push(`${name}: ${why}, so it was not saved`);
  };
  const qty = number(r.stock);
  keep("stock", Number.isFinite(qty) && Math.abs(qty) <= MAX_QTY ? Math.round(qty) : undefined, `quantity ${r.stock} is not a sensible number`);
  for (const k of ["price", "mrp"] as const) {
    const v = number(r[k]);
    keep(k, Number.isFinite(v) && v > 0 && v <= MAX_PRICE ? Math.round(v * 100) / 100 : undefined, `${k === "mrp" ? "MRP" : "price"} ₹${r[k]} is not sensible`);
  }
  const gst = number(r.gst_rate);
  keep("gst_rate", GST_RATES.includes(gst) ? gst : undefined, `GST ${r.gst_rate}% is not a GST rate`);
  const hsn = text(r.hsn, 8)?.replace(/\D/g, "");
  keep("hsn", hsn && /^\d{4,8}$/.test(hsn) ? hsn : undefined, `HSN ${r.hsn} is not 4 to 8 digits`);
  const exp = text(r.expiry, 10);
  const year = Number(exp?.slice(0, 4));
  keep("expiry", exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) && !Number.isNaN(Date.parse(exp)) && year >= 2000 && year <= 2045 ? exp : undefined, `expiry ${r.expiry} is not a real date`);
  keep("schedule", r.schedule === undefined || ["", "H", "H1", "X"].includes(r.schedule) ? r.schedule : undefined, `schedule ${r.schedule} is not H, H1 or X`);
  const box = number(r.box_qty);
  keep("box_qty", Number.isFinite(box) && box >= 1 && box <= 10_000 ? Math.round(box) : undefined, `units in a box ${r.box_qty} is not sensible`);
  keep("unit", text(r.unit, 20) || undefined, "the unit is empty");
  keep("salt", text(r.salt, 200) || undefined, "the contents are empty");
  keep("mfr", text(r.mfr, 80) || undefined, "the company is empty");
  keep("aliases", text(r.aliases, 300) || undefined, "the other names are empty");
  keep("batch", text(r.batch, 30) || undefined, "the batch is empty");
  keep("rack", text(r.rack, 30) || undefined, "the rack is empty");
  if (row.price && row.mrp && row.price > row.mrp) problems.push(`${name}: price ₹${row.price} is above the MRP ₹${row.mrp}; please check`);
  return { row, problems };
}

export function upsertItems(rows: InventoryRow[], mode: StockMode = "set", kind = mode === "set" ? "import" : "added"): UpsertResult {
  const d = db();
  const at = Date.now();
  const groups = new Map<string, InventoryRow[]>();
  const problems: string[] = [];
  for (const raw of rows) {
    const { row: r, problems: p } = cleanRow(raw);
    problems.push(...p);
    if (!r) continue;
    const key = r.name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  let added = 0;
  let updated = 0;
  let batches = 0;
  const names: string[] = [];
  tx(() => {
    for (const group of groups.values()) {
      const r = group[0];
      const pick = <K extends keyof InventoryRow>(k: K) => group.find((x) => x[k] !== undefined && x[k] !== "")?.[k];
      const withBatch = group.filter((x) => x.batch);
      const given = group.some((x) => x.stock !== undefined) ? group.reduce((s, x) => s + (x.stock ?? 0), 0) : undefined;
      const schedule = pick("schedule");
      let cur = d.prepare("SELECT * FROM items WHERE name = ? COLLATE NOCASE").get(r.name) as Item | undefined;
      const before = cur?.stock ?? 0;
      const stockNow = given === undefined ? before : mode === "add" ? Math.max(0, before + given) : given;
      if (!cur) {
        const id = Number(
          d
            .prepare("INSERT INTO items (name, aliases, unit, price, stock, salt, batch, expiry, hsn, gst_rate, schedule, rx, mfr, box_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(
              r.name, pick("aliases") ?? "", pick("unit") || "unit", pick("price") ?? 0, Math.max(0, given ?? 0), pick("salt") ?? "", pick("batch") ?? "", pick("expiry") ?? null,
              pick("hsn") || "3004", pick("gst_rate") ?? 5, schedule ?? "", schedule ? 1 : 0, pick("mfr") ?? "", Math.round(pick("box_qty") ?? 0),
            ).lastInsertRowid,
        );
        cur = d.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item;
        added++;
      } else {
        d.prepare("UPDATE items SET unit = ?, price = ?, stock = ?, aliases = ?, salt = ?, batch = ?, expiry = ?, hsn = ?, gst_rate = ?, schedule = ?, rx = ?, mfr = ?, box_qty = ? WHERE id = ?").run(
          pick("unit") || cur.unit, pick("price") ?? cur.price, stockNow, pick("aliases") || cur.aliases, pick("salt") || cur.salt,
          pick("batch") || cur.batch, pick("expiry") ?? cur.expiry, pick("hsn") || cur.hsn, pick("gst_rate") ?? cur.gst_rate,
          schedule ?? cur.schedule, schedule ? 1 : schedule === "" ? 0 : cur.rx, pick("mfr") || cur.mfr, Math.round(pick("box_qty") ?? cur.box_qty), cur.id,
        );
        updated++;
      }
      names.push(cur.name);

      const hasBatches = !!d.prepare("SELECT 1 FROM batches WHERE item_id = ? LIMIT 1").get(cur.id);
      if (withBatch.length) {
        // The same batch twice in one go (e.g. on two racks) is added up
        const qty = new Map<string, InventoryRow & { qty: number }>();
        for (const x of withBatch) {
          const prev = qty.get(x.batch!);
          qty.set(x.batch!, { ...x, qty: (prev?.qty ?? 0) + (x.stock ?? 0), rack: [prev?.rack, x.rack].filter(Boolean).join(", ") || undefined });
        }
        for (const [batch, x] of qty) {
          d.prepare(
            `INSERT INTO batches (item_id, batch, expiry, qty, mrp, rack, updated_at) VALUES (?,?,?,?,?,?,?)
             ON CONFLICT (item_id, batch) DO UPDATE SET expiry = COALESCE(excluded.expiry, expiry), qty = ${mode === "add" ? "MAX(0, qty + excluded.qty)" : "excluded.qty"},
               mrp = CASE WHEN excluded.mrp > 0 THEN excluded.mrp ELSE mrp END, rack = CASE WHEN excluded.rack != '' THEN excluded.rack ELSE rack END, updated_at = excluded.updated_at`,
          ).run(cur.id, batch, x.expiry ?? null, mode === "add" ? x.qty : Math.max(0, x.qty), x.mrp ?? 0, x.rack ?? "", at);
          batches++;
        }
        syncItem(cur.id);
      } else if (hasBatches && mode === "add" && given) {
        // Stock is counted from batches here, so stock without a batch number goes into an unnamed batch;
        // stock going out is taken from the batch that expires first.
        if (given > 0) {
          d.prepare(
            `INSERT INTO batches (item_id, batch, expiry, qty, mrp, rack, updated_at) VALUES (?, '', NULL, ?, ?, '', ?)
             ON CONFLICT (item_id, batch) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at`,
          ).run(cur.id, given, pick("mrp") ?? 0, at);
          syncItem(cur.id);
        } else consume(cur.id, -given);
      } else if (pick("mrp") !== undefined && hasBatches) {
        d.prepare("UPDATE batches SET mrp = ? WHERE item_id = ?").run(pick("mrp")!, cur.id);
      }
      const after = (d.prepare("SELECT stock FROM items WHERE id = ?").get(cur.id) as { stock: number }).stock;
      if (after !== before) d.prepare("INSERT INTO stock_movements (item_id, change, kind, at) VALUES (?,?,?,?)").run(cur.id, after - before, kind, at);
    }
  });
  return { added, updated, batches, names, problems };
}
