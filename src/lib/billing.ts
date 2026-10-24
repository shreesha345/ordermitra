import { db, type Customer, type Line, type Order } from "./db";
import { storeGstin } from "./brand";

// GST and credit terms. Everything that decides an amount of money lives here, so the WhatsApp messages,
// the invoice PDF, the payment link and the dashboard always agree.

const DAY = 86_400_000;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// GST
// ---------------------------------------------------------------------------

/** First two digits of a GSTIN are the state code (29 = Karnataka). */
const stateOf = (gstin: string) => (/^\d{2}/.test(gstin.trim()) ? gstin.trim().slice(0, 2) : "");

/** IGST when the retailer's GSTIN is from another state; CGST + SGST otherwise (and for unregistered retailers, who are local). */
export function isInterState(retailerGstin: string) {
  const a = stateOf(storeGstin());
  const b = stateOf(retailerGstin);
  return !!a && !!b && a !== b;
}

export type TaxLine = { itemId: number | null; name: string; hsn: string; batch: string; expiry: string | null; qty: number; rate: number; gstRate: number; taxable: number; tax: number; amount: number };
export type TaxSlab = { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number };
export type Bill = { lines: TaxLine[]; slabs: TaxSlab[]; subtotal: number; gst: number; total: number; igst: boolean };

/**
 * The bill for a set of lines. Rates are before tax. Tax is worked out per line and rounded to the paisa,
 * and CGST and SGST are each half of it, so the halves always add back up to the line's tax.
 */
export function computeBill(lines: (Pick<Line, "name" | "hsn" | "batch" | "expiry" | "qty_confirmed" | "unit_price" | "gst_rate"> & { item_id?: number | null })[], igst: boolean): Bill {
  const out: TaxLine[] = lines
    .filter((l) => l.qty_confirmed > 0)
    .map((l) => {
      const taxable = round2(l.qty_confirmed * l.unit_price);
      const half = round2((taxable * l.gst_rate) / 200);
      const tax = igst ? round2((taxable * l.gst_rate) / 100) : round2(half * 2);
      return { itemId: l.item_id ?? null, name: l.name, hsn: l.hsn, batch: l.batch, expiry: l.expiry, qty: l.qty_confirmed, rate: l.unit_price, gstRate: l.gst_rate, taxable, tax, amount: round2(taxable + tax) };
    });
  const slabs = new Map<number, TaxSlab>();
  for (const l of out) {
    const s = slabs.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    s.taxable = round2(s.taxable + l.taxable);
    if (igst) s.igst = round2(s.igst + l.tax);
    else {
      s.cgst = round2(s.cgst + l.tax / 2);
      s.sgst = round2(s.sgst + l.tax / 2);
    }
    slabs.set(l.gstRate, s);
  }
  const subtotal = round2(out.reduce((s, l) => s + l.taxable, 0));
  const gst = round2(out.reduce((s, l) => s + l.tax, 0));
  return { lines: out, slabs: [...slabs.values()].sort((a, b) => a.gstRate - b.gstRate), subtotal, gst, total: round2(subtotal + gst), igst };
}

// ---------------------------------------------------------------------------
// Invoice numbers: a GST invoice needs a serial of at most 16 characters, unique and consecutive within the
// financial year (April to March). Numbers are given only when a bill is issued, so cancelled orders leave no gaps.
// ---------------------------------------------------------------------------

/** 23 Oct 2026 -> "26-27" */
export function financialYear(at: number) {
  const d = new Date(at);
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Next number in the series for the year of `at`, e.g. INV/26-27/0042. INVOICE_PREFIX changes "INV" (up to 5 letters). */
export function nextInvoiceNo(at: number) {
  const prefix = (process.env.INVOICE_PREFIX || "INV").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5) || "INV";
  const series = `${prefix}/${financialYear(at)}/`;
  const last = db().prepare("SELECT MAX(CAST(SUBSTR(invoice_no, ?) AS INTEGER)) AS n FROM orders WHERE invoice_no LIKE ?").get(series.length + 1, `${series}%`) as { n: number | null };
  return `${series}${String((last.n ?? 0) + 1).padStart(4, "0")}`;
}

/** The invoice number to show for an order. Bills made before numbering existed keep their old form. */
export const invoiceNo = (o: { id: number; invoice_no?: string | null }) => o.invoice_no || `INV-${o.id}`;

/** 10540.5 -> "Ten Thousand Five Hundred Forty Rupees and Fifty Paise Only", in the Indian system (lakh, crore). */
export function amountInWords(n: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]} ${ones[x % 10]}`.trim());
  const three = (x: number) => [x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred` : "", two(x % 100)].filter(Boolean).join(" ");
  const words = (x: number): string => {
    if (x === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(x / 1e7);
    if (crore) parts.push(`${words(crore)} Crore`);
    const lakh = Math.floor((x % 1e7) / 1e5);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    const thousand = Math.floor((x % 1e5) / 1e3);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (x % 1e3) parts.push(three(x % 1e3));
    return parts.join(" ");
  };
  const rupees = Math.floor(round2(n));
  const paise = Math.round((round2(n) - rupees) * 100);
  return `${words(rupees)} Rupees${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}

// ---------------------------------------------------------------------------
// Credit terms: pay sooner, pay less
// ---------------------------------------------------------------------------

/** Days of credit on a bill before it counts as overdue. */
export const creditDays = () => Number(process.env.CREDIT_DAYS) || 30;

export type Tier = { days: number; pct: number };

/**
 * Prompt-payment discount, as "days:percent" pairs. The default "1:2,7:1,15:0.5" means 2% off if the bill is
 * paid within 1 day, 1% within 7 days, 0.5% within 15 days, and the full amount after that.
 */
export function tiers(): Tier[] {
  return (process.env.PROMPT_PAY_DISCOUNT ?? "1:2,7:1,15:0.5")
    .split(",")
    .map((p) => p.split(":").map(Number))
    .filter(([d, p]) => d > 0 && p > 0)
    .map(([days, pct]) => ({ days, pct }))
    .sort((a, b) => a.days - b.days);
}

export type Payable = { amount: number; discount: number; pct: number; until: number | null; dueAt: number; overdueDays: number };

/** What the retailer pays if they pay at `at`: the bill less the discount for that day, and when that offer ends. */
export function payable(o: Pick<Order, "total" | "billed_at" | "created_at">, at = Date.now()): Payable {
  const from = o.billed_at ?? o.created_at;
  const tier = tiers().find((t) => at <= from + t.days * DAY);
  const discount = tier ? round2((o.total * tier.pct) / 100) : 0;
  const dueAt = from + creditDays() * DAY;
  return {
    amount: round2(o.total - discount),
    discount,
    pct: tier?.pct ?? 0,
    until: tier ? from + tier.days * DAY : null,
    dueAt,
    overdueDays: Math.max(0, Math.floor((at - dueAt) / DAY)),
  };
}

/** The discount a credit note is issued for, split back into its taxable value and GST, in the bill's proportion. */
export function creditNote(o: Pick<Order, "subtotal" | "total" | "discount">) {
  const taxable = o.total ? round2((o.discount * o.subtotal) / o.total) : 0;
  return { taxable, gst: round2(o.discount - taxable), total: o.discount };
}

// ---------------------------------------------------------------------------
// Credit decision: approve on credit, ask for payment first, or send to the team
// ---------------------------------------------------------------------------

export type Verdict = "credit" | "pay_first" | "review";
export type Decision = { verdict: Verdict; reasons: string[] };

const UNPAID = "('awaiting_payment','confirmed_cod')";

/** Unpaid bills of a retailer, oldest first. */
export function unpaidBills(phone: string, excludeOrder = 0) {
  return db()
    .prepare(`SELECT * FROM orders WHERE phone = ? AND id != ? AND status IN ${UNPAID} ORDER BY COALESCE(billed_at, created_at)`)
    .all(phone, excludeOrder) as Order[];
}

export type Scheduled = { name: string; schedule: string };

/**
 * Whether a retailer may buy these scheduled medicines. Schedule H and H1 need a retail or wholesale drug
 * licence in Form 20 (20, 20A, 20B); Schedule X also needs Form 20F (retail) or 20G (wholesale).
 * The licence must be checked by the team (a photo the assistant read is only "pending") and in date.
 * Returns the problem, or null when the sale is allowed.
 */
export function licenceProblem(c: Pick<Customer, "drug_licence" | "licence_forms" | "licence_expiry" | "licence_status"> | undefined, items: Scheduled[]): string | null {
  if (!items.length) return null;
  const names = items.map((i) => `${i.name} (Schedule ${i.schedule || "H"})`).join(", ");
  if (!c?.drug_licence) return `${names} needs a drug licence, and none is on file`;
  if (c.licence_status !== "verified") return `${names} needs a verified drug licence; licence ${c.drug_licence} is ${c.licence_status === "pending" ? "waiting to be checked" : c.licence_status === "rejected" ? "rejected" : "not checked yet"}`;
  if (c.licence_expiry && new Date(c.licence_expiry).getTime() < Date.now()) return `Drug licence ${c.drug_licence} expired on ${c.licence_expiry}`;
  const forms = c.licence_forms.toUpperCase().split(/[\s,/]+/).filter(Boolean);
  if (items.some((i) => i.schedule === "X") && !forms.some((f) => f === "20F" || f === "20G")) return `Schedule X medicine needs a Form 20F or 20G licence; forms on file: ${c.licence_forms || "none"}`;
  if (forms.length && !forms.some((f) => /^20[AB]?$/.test(f) || f === "20F" || f === "20G")) return `Scheduled medicine needs a Form 20 licence; forms on file: ${c.licence_forms}`;
  return null;
}

/**
 * The rules, in order:
 * 1. Scheduled medicine without a verified, in-date licence: the team checks (it is illegal to sell otherwise).
 * 2. A bill past its credit period: no new credit; this order must be paid before dispatch.
 * 3. Over the credit limit with this order: the team approves or denies.
 * 4. Otherwise credit is approved.
 */
export function creditDecision(phone: string, orderTotal: number, scheduled: Scheduled[], excludeOrder = 0): Decision {
  const c = db().prepare("SELECT * FROM customers WHERE phone = ?").get(phone) as Customer | undefined;
  const licence = licenceProblem(c, scheduled);
  if (licence) return { verdict: "review", reasons: [licence] };
  const bills = unpaidBills(phone, excludeOrder);
  const overdue = bills.map((b) => ({ b, p: payable(b) })).filter((x) => x.p.overdueDays > 0);
  if (overdue.length) {
    const worst = overdue[0];
    return {
      verdict: "pay_first",
      reasons: [`${invoiceNo(worst.b)} is ${worst.p.overdueDays} day${worst.p.overdueDays === 1 ? "" : "s"} past its ${creditDays()}-day credit period, so this order must be paid before dispatch`],
    };
  }
  const due = bills.reduce((s, b) => s + b.total, 0) + orderTotal;
  if (c && due > c.credit_limit) {
    return { verdict: "review", reasons: [`Takes dues to ₹${Math.round(due).toLocaleString("en-IN")}, over the ₹${c.credit_limit.toLocaleString("en-IN")} credit limit`] };
  }
  return { verdict: "credit", reasons: [] };
}

/** Scheduled (prescription-only) items on an order, for the licence check. */
export function scheduledOn(orderId: number): Scheduled[] {
  return db()
    .prepare(
      `SELECT i.name, CASE WHEN i.schedule = '' THEN 'H' ELSE i.schedule END AS schedule FROM order_lines l JOIN items i ON i.id = l.item_id
       WHERE l.order_id = ? AND (i.rx = 1 OR i.schedule != '') AND l.status NOT IN ('not_needed','unmatched','dropped')`,
    )
    .all(orderId) as Scheduled[];
}

export type Grade = { grade: "A" | "B" | "C" | "D" | "New"; avgDays: number | null; hint: string };

/** How quickly a retailer pays, from bills settled in the last 90 days. Shown to the team; overdue bills drag it down. */
export function paymentGrade(phone: string): Grade {
  const rows = db()
    .prepare(`SELECT billed_at, paid_at FROM orders WHERE phone = ? AND status = 'paid' AND billed_at IS NOT NULL AND paid_at IS NOT NULL AND paid_at >= ?`)
    .all(phone, Date.now() - 90 * DAY) as { billed_at: number; paid_at: number }[];
  const overdue = unpaidBills(phone).some((b) => payable(b).overdueDays > 0);
  if (!rows.length) return { grade: overdue ? "D" : "New", avgDays: null, hint: overdue ? "Has an overdue bill" : "No paid bills yet" };
  const avg = rows.reduce((s, r) => s + (r.paid_at - r.billed_at) / DAY, 0) / rows.length;
  const grade = overdue || avg > creditDays() ? "D" : avg <= 2 ? "A" : avg <= 10 ? "B" : "C";
  return { grade, avgDays: Math.round(avg * 10) / 10, hint: `Pays in ~${avg < 1 ? "<1" : Math.round(avg)} day${Math.round(avg) === 1 ? "" : "s"}${overdue ? " · has an overdue bill" : ""}` };
}
