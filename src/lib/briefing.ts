import { createHash } from "node:crypto";
import { aiProvider } from "./ai";
import { atRisk } from "./batches";
import { payable, unpaidBills } from "./billing";
import { db, type Customer } from "./db";
import { gstDates, period } from "./gstr1";
import { inr } from "./i18n";
import { stockView } from "./insights";
import { targets } from "./outreach";
import { makeT, UI_LANGS, type T, type UiLang } from "./ui-lang";

// The owner's morning briefing: the few things worth doing today, worked out from the data,
// with a short summary written by the AI agent from those facts only.

const DAY = 86_400_000;

export type BriefAction =
  | { kind: "link"; href: string; label: string }
  | { kind: "remind"; remind: "dues" | "reorder"; label: string };
export type BriefItem = { id: string; tone: "red" | "amber" | "blue" | "green"; title: string; detail: string; action?: BriefAction };

/** n === 1 ? one : many, each an English key for t(). */
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function briefingItems(t: T = makeT("en")): BriefItem[] {
  const d = db();
  const items: BriefItem[] = [];

  // GST dates for the month being filed, from 5 days before each one
  const p = period();
  const next = gstDates(p).find((x) => x.days >= 0 && x.days <= 5);
  if (next) {
    const date = new Date(next.at).toLocaleDateString("en-IN", { day: "numeric", month: "long" });
    items.push({
      id: `gst-${next.key}`, tone: next.days <= 2 ? "red" : "amber",
      title: `${t(next.title)}: ${date} (${next.days === 0 ? t("Today") : next.days === 1 ? t("Tomorrow") : t("In {n} days", { n: next.days })})`,
      detail: t("GST for {month}", { month: p.label }),
      action: { kind: "link", href: "/gst", label: t("Open GST filing") },
    });
  }

  const held = (d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'awaiting_review'").get() as { n: number; v: number });
  if (held.n) {
    items.push({
      id: "held", tone: "red",
      title: t(pl(held.n, "{n} order needs your OK before it goes out", "{n} orders need your OK before they go out"), { n: held.n }),
      detail: t("{amount} on hold: the retailer owes too much or their drug licence is not checked", { amount: inr(Math.round(held.v)) }),
      action: { kind: "link", href: "/orders?view=attention", label: t("Look at them") },
    });
  }

  const overdue = targets("dues").map((c) => {
    const bills = unpaidBills(c.phone).map((b) => ({ b, p: payable(b) })).filter((x) => x.p.overdueDays > 0);
    return { c, due: bills.reduce((s, x) => s + x.b.total, 0), days: Math.max(...bills.map((x) => x.p.overdueDays)) };
  }).sort((a, b) => b.due - a.due);
  if (overdue.length) {
    items.push({
      id: "overdue", tone: "amber",
      title: t(pl(overdue.length, "{n} retailer is late paying {amount}", "{n} retailers are late paying {amount}"), { amount: inr(Math.round(overdue.reduce((s, x) => s + x.due, 0))), n: overdue.length }),
      detail: `${overdue.slice(0, 3).map((x) => `${x.c.name} (${t("{n} days late", { n: x.days })})`).join(", ")}. ${t("They must pay before they get more on credit.")}`,
      action: { kind: "remind", remind: "dues", label: t("Remind them on WhatsApp") },
    });
  }

  const requests = d.prepare("SELECT kind, COUNT(*) AS n FROM requests WHERE status = 'open' GROUP BY kind").all() as { kind: string; n: number }[];
  if (requests.length) {
    const words: Record<string, [string, string]> = {
      return: ["{n} return", "{n} returns"],
      licence: ["{n} licence to verify", "{n} licences to verify"],
      callback: ["{n} retailer wants a call", "{n} retailers want a call"],
    };
    items.push({
      id: "requests", tone: "blue",
      title: requests.map((r) => (words[r.kind] ? t(pl(r.n, ...words[r.kind]), { n: r.n }) : `${r.n} ${r.kind}`)).join(", "),
      detail: t("Sent by retailers on WhatsApp"),
      action: { kind: "link", href: "/requests", label: t("Open") },
    });
  }

  const stock = stockView();
  const runningOut = stock.filter((i) => i.coverDays !== null && i.coverDays <= 7).sort((a, b) => a.coverDays! - b.coverDays!);
  if (runningOut.length) {
    items.push({
      id: "stock", tone: "amber",
      title: t(pl(runningOut.length, "{n} product will run out this week", "{n} products will run out this week"), { n: runningOut.length }),
      detail: runningOut.slice(0, 3).map((i) => `${i.name}: ${i.coverDays ? t("lasts {n} more days, buy {q}", { n: i.coverDays, q: i.reorder }) : t("finished, buy {q}", { q: i.reorder })}`).join(" · "),
      action: { kind: "link", href: "/demand", label: t("What to buy") },
    });
  }

  const risk = atRisk(60);
  const expired = risk.filter((r) => r.days <= 0);
  const soon = risk.filter((r) => r.days > 0);
  if (expired.length) {
    items.push({
      id: "expired", tone: "red",
      title: t("{amount} of stock has already expired", { amount: inr(Math.round(expired.reduce((s, r) => s + r.value, 0))) }),
      detail: `${t(pl(expired.length, "{n} batch", "{n} batches"), { n: expired.length })}: ${expired.slice(0, 3).map((r) => `${r.name} ${r.batch}`).join(", ")}. ${t("Take it off the shelf and return it to the supplier.")}`,
      action: { kind: "link", href: "/inventory#expiry", label: t("Expiry report") },
    });
  }
  if (soon.length) {
    items.push({
      id: "expiry", tone: "amber",
      title: t("{amount} of stock expires within 60 days", { amount: inr(Math.round(soon.reduce((s, r) => s + r.value, 0))) }),
      detail: `${soon.slice(0, 3).map((r) => `${r.name} (${t("{n} days", { n: r.days })})`).join(", ")}${soon.length > 3 ? ` ${t("and {n} more", { n: soon.length - 3 })}` : ""}. ${t("Sell it first or return it to the supplier.")}`,
      action: { kind: "link", href: "/inventory#expiry", label: t("Expiry report") },
    });
  }

  const reorder = targets("reorder");
  if (reorder.length) {
    items.push({
      id: "reorder", tone: "blue",
      title: t(pl(reorder.length, "{n} retailer usually orders again about now", "{n} retailers usually order again about now"), { n: reorder.length }),
      detail: `${reorder.slice(0, 3).map((c: Customer) => c.name).join(", ")}. ${t("A friendly reminder often brings the order in.")}`,
      action: { kind: "remind", remind: "reorder", label: t("Send a reminder") },
    });
  }

  const missed = d.prepare(
    `SELECT COALESCE(SUM((l.qty_requested - l.qty_confirmed) * l.unit_price), 0) AS v FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.created_at >= ? AND l.item_id IS NOT NULL AND l.status IN ('available','dropped') AND l.qty_confirmed < l.qty_requested`,
  ).get(Date.now() - 14 * DAY) as { v: number };
  const unmatched = (d.prepare(`SELECT COUNT(*) AS n FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.created_at >= ? AND l.status = 'unmatched'`).get(Date.now() - 14 * DAY) as { n: number }).n;
  if (missed.v > 0 || unmatched) {
    items.push({
      id: "missed", tone: "blue",
      title: t("You missed {amount} of sales in 2 weeks because stock ran short", { amount: inr(Math.round(missed.v)) }),
      detail: `${unmatched ? `${t(pl(unmatched, "Plus {n} request for products you do not stock.", "Plus {n} requests for products you do not stock."), { n: unmatched })} ` : ""}${t("See what to buy so it does not happen again.")}`,
      action: { kind: "link", href: "/demand", label: t("What to buy") },
    });
  }

  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const early = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(discount), 0) AS v, COALESCE(SUM(paid_amount), 0) AS paid FROM orders WHERE status = 'paid' AND discount > 0 AND paid_at >= ?").get(month) as { n: number; v: number; paid: number };
  if (early.n) {
    items.push({
      id: "early", tone: "green",
      title: t(pl(early.n, "{n} bill paid early this month", "{n} bills paid early this month"), { n: early.n }),
      detail: t("{paid} came in early, for {discount} in early-payment discounts", { paid: inr(Math.round(early.paid)), discount: inr(Math.round(early.v)) }),
    });
  }
  return items;
}

const cache = globalThis as unknown as { briefing?: { key: string; text: string; at: number } };

/** Two or three sentences for the owner. Written by the AI from the items alone; plain facts without AI. */
export async function briefingSummary(items: BriefItem[], lang: UiLang = "en"): Promise<{ text: string; ai: boolean }> {
  const t = makeT(lang);
  if (!items.length) return { text: t("Nothing needs you right now: no held orders, nothing overdue, stock is healthy."), ai: false };
  const facts = items.map((i) => `- ${i.title}. ${i.detail}`).join("\n");
  const ai = aiProvider();
  if (!ai) return { text: items.slice(0, 2).map((i) => `${i.title}.`).join(" "), ai: false };
  const language = lang === "en" ? "English" : `${UI_LANGS[lang].name} (in its own script; keep product names, amounts and numbers as given)`;
  const key = createHash("sha1").update(lang + facts).digest("hex");
  if (cache.briefing?.key === key && Date.now() - cache.briefing.at < 30 * 60_000) return { text: cache.briefing.text, ai: true };
  try {
    const res = await ai.generate({
      system: `You brief the owner of an Indian pharmaceutical wholesaler each morning. From the facts below only, write 2 or 3 short sentences in ${language}, in simple everyday words a shop owner uses: what matters most today and what to do first. No jargon or short forms (write "days", not "d"). Use the numbers as given; add none. No greeting, no lists, no markdown.`,
      messages: [{ role: "user", parts: [{ text: facts }] }],
    });
    const text = res.text.replace(/\*+/g, "").trim();
    if (!text) throw new Error("empty");
    cache.briefing = { key, text, at: Date.now() };
    return { text, ai: true };
  } catch (e) {
    console.error("briefing failed", e);
    return { text: items.slice(0, 2).map((i) => `${i.title}.`).join(" "), ai: false };
  }
}
