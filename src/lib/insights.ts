import { refreshExpiry } from "./batches";
import { creditDecision, scheduledOn } from "./billing";
import { db, type Item, type Order } from "./db";

const DAY = 86_400_000;

/** Minutes a staff member spends taking one order over the phone. Drives the "hours saved" figure. */
export const callMinutes = () => Number(process.env.CALL_MINUTES) || 6;

/** Orders billed but not yet paid: waiting for UPI, or delivered on credit (pay later). */
export const UNPAID = ["awaiting_payment", "confirmed_cod"];

export function outstanding(phone: string, excludeOrder?: number) {
  const r = db()
    .prepare(`SELECT COALESCE(SUM(total), 0) AS due FROM orders WHERE phone = ? AND id != ? AND status IN ('awaiting_payment','confirmed_cod')`)
    .get(phone, excludeOrder ?? 0) as { due: number };
  return r.due;
}

/** Oldest unpaid bill, in days. */
export function oldestDueDays(phone: string) {
  const r = db()
    .prepare(`SELECT MIN(updated_at) AS at FROM orders WHERE phone = ? AND status IN ('awaiting_payment','confirmed_cod')`)
    .get(phone) as { at: number | null };
  return r.at ? Math.floor((Date.now() - r.at) / DAY) : null;
}

export const freeStock = (i: Pick<Item, "stock" | "reserved">) => Math.max(0, i.stock - i.reserved);

/** Units sold per day over the last 30 days, by item id. */
export function velocity(): Map<number, number> {
  const rows = db()
    .prepare(`SELECT item_id, -SUM(change) AS sold FROM stock_movements WHERE kind = 'deducted' AND at >= ? GROUP BY item_id`)
    .all(Date.now() - 30 * DAY) as { item_id: number; sold: number }[];
  return new Map(rows.map((r) => [r.item_id, r.sold / 30]));
}

export type StockView = Item & { free: number; perDay: number; coverDays: number | null; reorder: number; expiryDays: number | null };

/** Stock with days of cover, a 30-day reorder suggestion and days to expiry. */
export function stockView(): StockView[] {
  refreshExpiry();
  const v = velocity();
  const items = db().prepare("SELECT * FROM items ORDER BY name").all() as Item[];
  return items.map((i) => {
    const free = freeStock(i);
    const perDay = v.get(i.id) ?? 0;
    return {
      ...i,
      free,
      perDay,
      coverDays: perDay > 0 ? Math.floor(free / perDay) : null,
      reorder: Math.max(0, Math.ceil(perDay * 30 + i.min_stock - free)),
      expiryDays: i.expiry ? Math.ceil((new Date(i.expiry).getTime() - Date.now()) / DAY) : null,
    };
  });
}

export const NEAR_EXPIRY_DAYS = 90;

export type Flag = { tone: "red" | "amber"; text: string };

/**
 * Licence and credit checks a person should look at before the order ships. A billed order keeps the decision
 * made when it was billed; an open one is checked now, the same way it will be at billing.
 */
export function orderFlags(order: Pick<Order, "id" | "phone" | "total" | "status" | "credit_verdict" | "credit_reasons">): Flag[] {
  if (order.credit_verdict) {
    const tone = order.credit_verdict === "credit" ? null : order.status === "awaiting_review" || order.credit_verdict === "review" ? "red" : "amber";
    return tone ? (JSON.parse(order.credit_reasons) as string[]).map((text) => ({ tone, text })) : [];
  }
  if (["paid", "confirmed_cod", "cancelled"].includes(order.status)) return [];
  const est = order.total || (db().prepare("SELECT COALESCE(SUM(qty_requested * unit_price * (1 + gst_rate / 100)), 0) AS v FROM order_lines WHERE order_id = ? AND status = 'pending'").get(order.id) as { v: number }).v;
  const d = creditDecision(order.phone, est, scheduledOn(order.id), order.id);
  return d.reasons.map((text) => ({ tone: d.verdict === "review" ? "red" : "amber", text }));
}

export type Attention = { id: number; phone: string; name: string; total: number; status: string; created_at: number; reasons: Flag[] };

/** Open orders a person should look at, with the reasons. Orders waiting for a credit decision come first. */
export function attention(): Attention[] {
  const open = db()
    .prepare(
      `SELECT o.*, COALESCE(c.name, o.phone) AS name FROM orders o
       LEFT JOIN customers c ON c.phone = o.phone
       WHERE o.status IN ('awaiting_review','awaiting_approval','awaiting_customer','awaiting_confirm','awaiting_payment') ORDER BY o.status = 'awaiting_review' DESC, o.id DESC`,
    )
    .all() as (Order & { name: string })[];
  return open
    .map((o) => {
      const reasons = orderFlags(o);
      if (o.status === "awaiting_review" && !reasons.length) reasons.push({ tone: "red", text: "Needs your OK before it goes out" });
      if (o.status === "awaiting_customer") reasons.push({ tone: "amber", text: "Some items are short; the retailer is choosing what to do" });
      const days = Math.floor((Date.now() - o.updated_at) / DAY);
      if (o.status === "awaiting_payment" && days >= 1) reasons.push({ tone: "amber", text: `Bill sent ${days} day${days > 1 ? "s" : ""} ago; not paid yet` });
      return { id: o.id, phone: o.phone, name: o.name, total: o.total, status: o.status, created_at: o.created_at, reasons };
    })
    .filter((o) => o.reasons.length);
}

export type Regular = { item_id: number; name: string; times: number; avg_qty: number; last_at: number; every: number; dueAgain: boolean };

/** What a pharmacy buys regularly, and whether it is due again based on how often they order it. */
export function regularItems(phone: string): Regular[] {
  return (
    db()
      .prepare(
        `SELECT l.item_id, i.name, COUNT(*) AS times, ROUND(AVG(l.qty_confirmed)) AS avg_qty, MAX(o.created_at) AS last_at, MIN(o.created_at) AS first_at
         FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN items i ON i.id = l.item_id
         WHERE o.phone = ? AND l.qty_confirmed > 0 AND o.status IN ('paid','confirmed_cod','awaiting_payment')
         GROUP BY l.item_id HAVING times >= 2 ORDER BY times DESC LIMIT 8`,
      )
      .all(phone) as (Omit<Regular, "every" | "dueAgain"> & { first_at: number })[]
  ).map(({ first_at, ...r }) => {
    const every = Math.max(1, (r.last_at - first_at) / DAY / (r.times - 1));
    return { ...r, every: Math.round(every), dueAgain: daysSince(r.last_at) >= every };
  });
}

/** Request time, for server components (they render once per request, so this is stable). */
export const now = () => Date.now();
export const daysSince = (at: number) => Math.floor((Date.now() - at) / DAY);
