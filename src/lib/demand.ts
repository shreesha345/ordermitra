import { refreshExpiry } from "./batches";
import { db, type Item } from "./db";
import { freeStock } from "./insights";

// Demand and a short-term forecast per product, from what retailers asked for on WhatsApp.
//
// Demand is the quantity asked for, not only what was billed: when an item was short, the part we could not
// supply is still demand. Weekly demand over the last WEEKS weeks feeds Holt's smoothing with a damped trend (a
// level and a trend, each updated week by week, the trend fading over the horizon), which gives the next 30 days. Safety stock covers the forecast error over
// the supplier lead time, so the suggestion is: forecast for 30 days + safety stock - free stock.

const DAY = 86_400_000;
const WEEK = 7 * DAY;
export const WEEKS = 12;
const ALPHA = 0.5; // how fast the level follows recent weeks
const BETA = 0.3; // how fast the trend follows
const PHI = 0.8; // trend damping: a rise is not assumed to go on at the same pace
const Z = 1.65; // safety stock for ~95% of weeks without a stock-out

/** Days from placing a purchase order with the supplier to having the stock. */
export const leadDays = () => Number(process.env.SUPPLIER_LEAD_DAYS) || 7;

export type Trend = "rising" | "falling" | "steady" | "new" | "quiet";
export type Confidence = "high" | "medium" | "low";

export type Demand = {
  item: Item;
  free: number;
  weekly: number[]; // oldest first, WEEKS values
  last30: number; // asked for in the last 30 days
  prev30: number; // the 30 days before
  sold30: number; // of which we supplied
  value30: number; // last30 at today's rate
  change: number | null; // last30 vs prev30, as a fraction
  trend: Trend;
  forecast30: number;
  perDay: number;
  safety: number;
  runsOutIn: number | null; // days
  suggest: number; // units to order now
  confidence: Confidence;
  reasons: string[]; // English keys with {vars}, translated on the page
  vars: Record<string, string | number>;
};

function holt(series: number[]) {
  // Start from the first week with demand, so a product added recently does not look like it is rising from zero
  const start = Math.max(0, series.findIndex((x) => x > 0));
  const s = series.slice(start);
  if (s.length < 3) {
    const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    return { level: avg, trend: 0, errors: s.map((x) => x - avg) };
  }
  let level = s[0];
  let trend = (s[Math.min(3, s.length - 1)] - s[0]) / Math.min(3, s.length - 1);
  const errors: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const predicted = level + PHI * trend;
    errors.push(s[i] - predicted);
    const prevLevel = level;
    level = ALPHA * s[i] + (1 - ALPHA) * predicted;
    trend = BETA * (level - prevLevel) + (1 - BETA) * PHI * trend;
  }
  return { level, trend, errors };
}

const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

export function demandReport(at = Date.now()) {
  refreshExpiry();
  const d = db();
  const items = d.prepare("SELECT * FROM items ORDER BY name").all() as Item[];
  const since = at - WEEKS * WEEK;
  // Edited orders are cancelled and sent again, so cancelled orders count only for the lines that went unsupplied.
  const rows = d
    .prepare(
      `SELECT l.item_id, o.created_at AS at, l.qty_requested AS asked, l.qty_confirmed AS got
       FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE l.item_id IS NOT NULL AND o.created_at >= ? AND l.status NOT IN ('not_needed','unmatched')
         AND (o.status != 'cancelled' OR l.status IN ('dropped','short','out'))`,
    )
    .all(since) as { item_id: number; at: number; asked: number; got: number }[];

  const by = new Map<number, typeof rows>();
  for (const r of rows) by.set(r.item_id, [...(by.get(r.item_id) ?? []), r]);
  const lead = leadDays();

  const list: Demand[] = items.map((item) => {
    const rs = by.get(item.id) ?? [];
    const weekly = Array.from({ length: WEEKS }, () => 0);
    let last30 = 0, prev30 = 0, sold30 = 0;
    for (const r of rs) {
      const w = WEEKS - 1 - Math.floor((at - r.at) / WEEK);
      if (w >= 0) weekly[w] += r.asked;
      const age = (at - r.at) / DAY;
      if (age < 30) { last30 += r.asked; sold30 += r.got; } else if (age < 60) prev30 += r.asked;
    }
    const free = freeStock(item);
    const weeksWithDemand = weekly.filter((x) => x > 0).length;
    const { level, trend: slope, errors } = holt(weekly);
    // Next ~4.3 weeks, never below zero
    const damp = (h: number) => Array.from({ length: h }, (_, k) => PHI ** (k + 1)).reduce((a, b) => a + b, 0);
    const forecast30 = Math.round(Array.from({ length: 4 }, (_, h) => Math.max(0, level + damp(h + 1) * slope)).reduce((a, b) => a + b, 0) * (30 / 28));
    const perDay = forecast30 / 30;
    const safety = Math.ceil(Z * sd(errors) * Math.sqrt(lead / 7));
    const cv = level > 0 ? sd(errors) / level : 1;
    const confidence: Confidence = weeksWithDemand >= 8 && cv < 0.5 ? "high" : weeksWithDemand >= 4 && cv < 1 ? "medium" : "low";
    // With little history, order for two weeks rather than a month, until the pattern is clearer
    const cover = confidence === "low" ? 14 : 30;
    const raw = Math.max(0, (forecast30 * cover) / 30 + safety - free);
    const suggest = raw && item.box_qty > 1 ? Math.ceil(raw / item.box_qty) * item.box_qty : Math.ceil(raw);
    const runsOutIn = perDay > 0 ? Math.floor(free / perDay) : null;
    const change = prev30 > 0 ? (last30 - prev30) / prev30 : null;
    const trend: Trend = !last30 && !prev30 ? "quiet" : !prev30 ? "new" : change! >= 0.25 ? "rising" : change! <= -0.25 ? "falling" : "steady";
    const reasons: string[] = [];
    const vars: Record<string, string | number> = { pct: change === null ? 0 : Math.round(Math.abs(change) * 100), days: runsOutIn ?? 0, lead, short: last30 - sold30, n: forecast30 };
    if (trend === "rising") reasons.push("Selling {pct}% more than last month");
    if (runsOutIn === 0) reasons.push("Already finished");
    else if (runsOutIn !== null && runsOutIn <= lead) reasons.push("Finishes in {days} days, but a new order takes {lead} days to arrive");
    else if (runsOutIn !== null && runsOutIn <= 30) reasons.push("Lasts about {days} more days");
    if (trend === "falling") reasons.push("Selling {pct}% less than last month, so buy less than before");
    if (last30 > sold30) reasons.push("Retailers wanted {short} more than you had this month");
    if (!reasons.length && suggest) reasons.push("Expect to sell {n} this month");
    if (suggest && confidence === "low") reasons.push("Few orders so far, so this is enough for 2 weeks only");

    return {
      item, free, weekly, last30, prev30, sold30, value30: last30 * item.price, change, trend,
      forecast30, perDay, safety, runsOutIn, suggest, confidence, reasons, vars,
    };
  });

  const active = list.filter((x) => x.last30 || x.prev30 || x.forecast30);
  // Stock up: something to order, most urgent first
  const stockUp = active
    .filter((x) => x.suggest > 0 && (x.runsOutIn === null || x.runsOutIn <= 30 || x.trend === "rising"))
    .sort((a, b) => (a.runsOutIn ?? 999) - (b.runsOutIn ?? 999) || b.value30 - a.value30);
  const best = [...active].filter((x) => x.last30).sort((a, b) => b.value30 - a.value30);
  // Hold back: falling or idle, with more than 60 days of stock at the forecast rate
  const slow = list
    .filter((x) => x.free > 0 && (x.trend === "falling" || x.trend === "quiet" || (x.runsOutIn !== null && x.runsOutIn > 90)) && (x.perDay === 0 || x.free / x.perDay > 60))
    .sort((a, b) => b.free * b.item.price - a.free * a.item.price);

  // Total demand per week, at today's rates
  const weeklyValue = Array.from({ length: WEEKS }, (_, w) => list.reduce((s, x) => s + x.weekly[w] * x.item.price, 0));
  const missed = list.reduce((s, x) => s + Math.max(0, x.last30 - x.sold30) * x.item.price, 0);
  return { list, stockUp, best, slow, weeklyValue, missed, lead };
}
