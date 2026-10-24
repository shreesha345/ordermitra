import { db, type Batch } from "./db";

// Stock is held per batch, each with its own expiry. An item's stock is what is left in batches that have
// not expired (expired medicine cannot be sold), and its batch and expiry, as printed on the invoice, are
// those of the batch that expires first. Sales use that batch first (first expiry, first out).

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

/** Recomputes one item's stock, batch and expiry from its batches. Items without batches are left alone. */
export function syncItem(itemId: number) {
  const d = db();
  const live = d
    .prepare("SELECT batch, expiry, qty FROM batches WHERE item_id = ? AND qty > 0 AND (expiry IS NULL OR expiry > ?) ORDER BY expiry IS NULL, expiry")
    .all(itemId, today()) as Pick<Batch, "batch" | "expiry" | "qty">[];
  const any = d.prepare("SELECT 1 FROM batches WHERE item_id = ? LIMIT 1").get(itemId);
  if (!any) return;
  const stock = live.reduce((s, b) => s + b.qty, 0);
  d.prepare("UPDATE items SET stock = ?, reserved = MIN(reserved, ?), batch = ?, expiry = ? WHERE id = ?").run(stock, stock, live[0]?.batch ?? "", live[0]?.expiry ?? null, itemId);
}

const state = globalThis as unknown as { batchesSyncedOn?: string };

/** Once a day (or after a restart), takes batches that have just expired out of sellable stock. */
export function refreshExpiry() {
  if (state.batchesSyncedOn === today()) return;
  for (const { item_id } of db().prepare("SELECT DISTINCT item_id FROM batches").all() as { item_id: number }[]) syncItem(item_id);
  state.batchesSyncedOn = today();
}

/** Takes qty out of an item's batches, earliest expiry first. Call inside the transaction that deducts stock. */
export function consume(itemId: number, qty: number) {
  const d = db();
  const rows = d
    .prepare("SELECT id, qty FROM batches WHERE item_id = ? AND qty > 0 AND (expiry IS NULL OR expiry > ?) ORDER BY expiry IS NULL, expiry")
    .all(itemId, today()) as { id: number; qty: number }[];
  if (!rows.length) return;
  let left = qty;
  for (const b of rows) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    d.prepare("UPDATE batches SET qty = qty - ?, updated_at = ? WHERE id = ?").run(take, Date.now(), b.id);
    left -= take;
  }
  syncItem(itemId);
}

export type ExpiryRow = { id: number; item_id: number; name: string; unit: string; batch: string; expiry: string; qty: number; rack: string; mfr: string; price: number; mrp: number; days: number; value: number };

/** Every batch with stock and an expiry date, soonest first, with days left and value at the selling rate. */
export function expiryRows(): ExpiryRow[] {
  const rows = db()
    .prepare(
      `SELECT b.id, b.item_id, i.name, i.unit, b.batch, b.expiry, b.qty, b.rack, i.mfr, i.price, b.mrp FROM batches b JOIN items i ON i.id = b.item_id
       WHERE b.qty > 0 AND b.expiry IS NOT NULL ORDER BY b.expiry, i.name`,
    )
    .all() as Omit<ExpiryRow, "days" | "value">[];
  const now = Date.now();
  return rows.map((r) => ({ ...r, days: Math.ceil((new Date(r.expiry).getTime() - now) / DAY), value: r.qty * r.price }));
}

export const EXPIRY_BUCKETS = [
  { id: "expired", label: "Already expired", max: 0, tone: "red", advice: "Take off the shelf; return to the supplier or destroy" },
  { id: "d30", label: "Expires within 30 days", max: 30, tone: "red", advice: "Most retailers will not accept it now; return it to the supplier" },
  { id: "d90", label: "Expires in 31 to 90 days", max: 90, tone: "amber", advice: "Sell first: offer it to retailers who buy it regularly" },
  { id: "d180", label: "Expires in 3 to 6 months", max: 180, tone: "blue", advice: "Watch: do not reorder more than you will sell before then" },
] as const;

/** Groups the expiry rows into the buckets above. */
export function expiryReport(rows = expiryRows()) {
  let min = -Infinity;
  return EXPIRY_BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.days > min && r.days <= b.max);
    min = b.max;
    return { ...b, rows: inBucket, qty: inBucket.reduce((s, r) => s + r.qty, 0), value: inBucket.reduce((s, r) => s + r.value, 0) };
  });
}

/** Stock expiring within maxDays (or already expired): batches, plus products imported without batch details. */
export function atRisk(maxDays: number) {
  const fromBatches = expiryRows().filter((r) => r.days <= maxDays);
  const loose = (
    db()
      .prepare("SELECT id AS item_id, name, unit, batch, expiry, stock AS qty, price FROM items i WHERE expiry IS NOT NULL AND stock > 0 AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.item_id = i.id)")
      .all() as { item_id: number; name: string; unit: string; batch: string; expiry: string; qty: number; price: number }[]
  )
    .map((r) => ({ ...r, days: Math.ceil((new Date(r.expiry).getTime() - Date.now()) / DAY), value: r.qty * r.price }))
    .filter((r) => r.days <= maxDays);
  return [...fromBatches, ...loose].sort((a, b) => a.days - b.days);
}
