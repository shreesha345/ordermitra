import { randomBytes } from "node:crypto";
import { db, type Item, type Line, type Order } from "./db";
import { substitutes } from "./match";
import { t, type Key, type Lang } from "./i18n";
import { sellingUnit, UNITS } from "./units";

// The retailer's own view of an order, for lists too long for a WhatsApp message (WhatsApp cuts a message with
// buttons at 1024 characters). Each line says plainly where it stands: available, short (asked vs have), out of
// stock, or not in our list. Before the stock check this is a live preview against current free stock.

export type LineState = "available" | "short" | "out" | "missing" | "not_needed" | "removed";
export type LineView = { line: Line; state: LineState; have: number; unit: string | null; sub: string | null };

/** More lines than this, or a longer message, and the retailer gets a link instead of the full list. */
export const LINK_OVER_LINES = 15;
export const LINK_OVER_CHARS = 900;

const free = (i: Pick<Item, "stock" | "reserved">) => Math.max(0, i.stock - i.reserved);

/** The order's unguessable link token, made the first time it is needed. */
export function viewToken(orderId: number) {
  const d = db();
  const cur = (d.prepare("SELECT view_token FROM orders WHERE id = ?").get(orderId) as { view_token: string | null } | undefined)?.view_token;
  if (cur) return cur;
  const token = `${orderId}-${randomBytes(9).toString("base64url")}`;
  d.prepare("UPDATE orders SET view_token = ? WHERE id = ? AND view_token IS NULL").run(token, orderId);
  return token;
}

export const orderLink = (orderId: number) => `${(process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/o/${viewToken(orderId)}`;

export const orderByToken = (token: string) => db().prepare("SELECT * FROM orders WHERE view_token = ?").get(token) as Order | undefined;

export function lineViews(orderId: number): LineView[] {
  const d = db();
  const lines = d.prepare("SELECT * FROM order_lines WHERE order_id = ? ORDER BY id").all(orderId) as Line[];
  return lines.map((line) => {
    const item = line.item_id ? (d.prepare("SELECT * FROM items WHERE id = ?").get(line.item_id) as Item | undefined) : undefined;
    const have = item ? free(item) : 0;
    const unit = item ? sellingUnit(item) : null;
    const base = { line, have, unit, sub: null };
    if (line.status === "unmatched" || !item) return { ...base, state: "missing" as const };
    if (line.status === "not_needed") return { ...base, state: "not_needed" as const };
    if (line.status === "dropped") return { ...base, state: "removed" as const };
    if (line.status === "available") return { ...base, state: "available" as const };
    // pending (not checked yet), short or out: where it stands right now
    const state: LineState = have >= line.qty_requested ? "available" : have > 0 ? "short" : "out";
    const sub = state === "available" ? null : (substitutes(item)[0]?.name ?? null);
    return { ...base, state, sub };
  });
}

export function countStates(views: LineView[]) {
  const n = { available: 0, short: 0, out: 0, missing: 0, not_needed: 0, removed: 0 } satisfies Record<LineState, number>;
  for (const v of views) n[v.state]++;
  return n;
}

/** "strip" in the retailer's language. */
export const unitWord = (lang: Lang, u: string) => ((UNITS as readonly string[]).includes(u) ? t(lang, `unit_${u}` as Key) : u);

/** "45 tablet" (what was written) with the unit in the retailer's language: "45 गोली". */
export const wroteText = (lang: Lang, note: string) => note.replace(/^\?/, "").replace(/[a-z]+$/, (u) => unitWord(lang, u));

/** "7 strip" in the retailer's language. */
export const qtyText = (lang: Lang, n: number, unit: string | null) => `${n}${unit ? ` ${unitWord(lang, unit)}` : ""}`;
