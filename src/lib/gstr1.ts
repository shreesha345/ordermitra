import { computeBill, creditNote, round2 } from "./billing";
import { storeGstin } from "./brand";
import { db, type Customer, type Item, type Line, type Order } from "./db";
import { placeOfSupply, validGstin } from "./gstin";
import { sellingUnit } from "./units";
import type { Cell, Sheet } from "./xlsx";

// GSTR-1 for a month, from the bills this app issued, laid out like the GST offline tool's Excel template:
//   b2b       invoices to GST-registered retailers, one row per invoice and tax rate      (Table 4A)
//   b2cs      bills to unregistered retailers, summed by place of supply and rate         (Table 7)
//   cdnr      credit notes to registered retailers (prompt-payment discounts)            (Table 9B)
//   hsn(b2b), hsn(b2c)  HSN-wise summary, net of credit notes                             (Table 12)
//   docs      serial ranges of invoices and credit notes issued                           (Table 13)
// Plus the GSTR-3B 3.1(a) figures. Unregistered retailers are taken to be in your own state (intra-state),
// since only a GSTIN tells us otherwise, so B2CL (large inter-state B2C invoices) stays empty.

export type Period = { key: string; label: string; from: number; to: number };

export function period(key?: string | null): Period {
  const now = new Date();
  // Default: the month still being filed. Its GST is paid by the 20th, so until then that is last month's.
  const back = now.getDate() <= 20 ? 1 : 0;
  const def = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const [y, m] = key && /^\d{4}-\d{2}$/.test(key) ? key.split("-").map(Number) : [def.getFullYear(), def.getMonth() + 1];
  const from = new Date(y, m - 1, 1).getTime();
  const to = new Date(y, m, 1).getTime();
  return { key: `${y}-${String(m).padStart(2, "0")}`, label: new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }), from, to };
}

export type GstDate = { key: "send" | "file" | "pay"; title: string; detail: string; at: number; days: number };

/**
 * The dates that matter for a month's GST, for monthly filers: send the file to the accountant by the 5th,
 * the sales return (GSTR-1) is due on the 11th and the payment (GSTR-3B) on the 20th of the next month.
 * `days` is how many days from today (negative once passed).
 */
export function gstDates(p: Period, now = new Date()): GstDate[] {
  const next = new Date(p.to);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const on = (day: number) => new Date(next.getFullYear(), next.getMonth(), day).getTime();
  return [
    { key: "send" as const, title: "Send the file to your accountant", detail: "So they have a few days to check it", at: on(5) },
    { key: "file" as const, title: "Last day to file your sales", detail: "Your accountant uploads the list of your bills (they call it GSTR-1)", at: on(11) },
    { key: "pay" as const, title: "Last day to pay the GST", detail: "Late payment means a fine and interest (they call it GSTR-3B)", at: on(20) },
  ].map((x) => ({ ...x, days: Math.round((x.at - today) / 86_400_000) }));
}

/** "05-Oct-2026", as the offline tool expects. */
const gstDate = (at: number) => {
  const d = new Date(at);
  return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;
};

const HSN_TEXT: Record<string, string> = {
  "3003": "Medicaments, not in measured doses",
  "3004": "Medicaments in measured doses",
  "3005": "Wadding, gauze, bandages",
  "3006": "Pharmaceutical goods",
  "3304": "Skin care preparations",
  "3401": "Soap",
  "3808": "Disinfectants",
  "2106": "Food preparations n.e.c.",
  "9018": "Medical instruments",
};

/** Unit Quantity Code from the selling unit. Check against your own practice; NOS is the safe default. */
const UQC: Record<string, string> = { bottle: "BTL", tube: "TUB", box: "BOX", case: "CTN", tablet: "TBS" };

type Bill = ReturnType<typeof computeBill>;
type Invoice = { order: Order; customer: Customer | undefined; b2b: boolean; pos: string; bill: Bill; no: string };
type Note = Invoice & { cnNo: string; at: number; cn: ReturnType<typeof creditNote> };

const r2 = round2;

export function gstr1(p: Period) {
  const d = db();
  const home = storeGstin().slice(0, 2);
  const customers = new Map((d.prepare("SELECT * FROM customers").all() as Customer[]).map((c) => [c.phone, c]));
  const items = new Map((d.prepare("SELECT * FROM items").all() as Item[]).map((i) => [i.id, i]));
  const lines = (id: number) => d.prepare("SELECT * FROM order_lines WHERE order_id = ? AND qty_confirmed > 0 ORDER BY id").all(id) as Line[];
  const asInvoice = (o: Order): Invoice => {
    const c = customers.get(o.phone);
    const b2b = !!c?.gstin && validGstin(c.gstin);
    return { order: o, customer: c, b2b, pos: b2b ? c!.gstin.slice(0, 2) : home, bill: computeBill(lines(o.id), o.igst === 1), no: o.invoice_no || `INV-${o.id}` };
  };

  const billed = d.prepare("SELECT * FROM orders WHERE billed_at >= ? AND billed_at < ? ORDER BY billed_at, id").all(p.from, p.to) as Order[];
  const invoices = billed.filter((o) => o.status !== "cancelled").map(asInvoice);
  const cancelled = billed.filter((o) => o.status === "cancelled");
  // Credit notes are dated the day the discounted payment came in, so they fall in that month's return
  const notes: Note[] = (d.prepare("SELECT * FROM orders WHERE status = 'paid' AND discount > 0 AND paid_at >= ? AND paid_at < ? ORDER BY paid_at, id").all(p.from, p.to) as Order[]).map((o) => {
    const inv = asInvoice(o);
    return { ...inv, cnNo: `CN-${inv.no.replace(/^\w+\//, "")}`, at: o.paid_at!, cn: creditNote(o) };
  });
  // A credit note split over the invoice's tax rates and lines, in proportion to their taxable value
  const share = (n: Note, taxable: number) => (n.bill.subtotal ? taxable / n.bill.subtotal : 0);

  // ---- b2b
  const B2B_HEAD = ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"];
  const b2b: Cell[][] = invoices.filter((i) => i.b2b).flatMap((i) =>
    i.bill.slabs.map((s) => [i.customer!.gstin, i.customer!.name, i.no, gstDate(i.order.billed_at!), r2(i.bill.total), placeOfSupply(i.pos), "N", null, "Regular B2B", null, s.gstRate, r2(s.taxable), 0]),
  );

  // ---- b2cs: invoices less their credit notes, by place of supply and rate
  const B2CS_HEAD = ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"];
  const b2csMap = new Map<string, { pos: string; rate: number; taxable: number }>();
  const addB2cs = (pos: string, rate: number, taxable: number) => {
    const k = `${pos}|${rate}`;
    const cur = b2csMap.get(k) ?? { pos, rate, taxable: 0 };
    cur.taxable += taxable;
    b2csMap.set(k, cur);
  };
  for (const i of invoices.filter((x) => !x.b2b)) for (const s of i.bill.slabs) addB2cs(i.pos, s.gstRate, s.taxable);
  for (const n of notes.filter((x) => !x.b2b)) for (const s of n.bill.slabs) addB2cs(n.pos, s.gstRate, -n.cn.taxable * share(n, s.taxable));
  const b2cs: Cell[][] = [...b2csMap.values()].map((x) => ["OE", placeOfSupply(x.pos), null, x.rate, r2(x.taxable), 0, null]);

  // ---- cdnr
  const CDNR_HEAD = ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"];
  const cdnr: Cell[][] = notes.filter((n) => n.b2b).flatMap((n) =>
    n.bill.slabs.map((s) => [n.customer!.gstin, n.customer!.name, n.cnNo, gstDate(n.at), "C", placeOfSupply(n.pos), "N", "Regular B2B", r2(n.cn.total), null, s.gstRate, r2(n.cn.taxable * share(n, s.taxable)), 0]),
  );

  // ---- hsn, split B2B / B2C, net of credit notes
  type H = { hsn: string; desc: string; uqc: string; qty: number; value: number; rate: number; taxable: number; igst: number; cgst: number; sgst: number };
  const hsnMaps = { b2b: new Map<string, H>(), b2c: new Map<string, H>() };
  const addHsn = (i: Invoice, factor: number, countQty: boolean) => {
    const m = i.b2b ? hsnMaps.b2b : hsnMaps.b2c;
    for (const l of i.bill.lines) {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      const unit = item ? sellingUnit(item) : null;
      const uqc = (unit && UQC[unit]) || "NOS";
      const k = `${l.hsn}|${l.gstRate}|${uqc}`;
      const cur = m.get(k) ?? { hsn: l.hsn, desc: HSN_TEXT[l.hsn.slice(0, 4)] ?? l.name, uqc, qty: 0, value: 0, rate: l.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      if (countQty) cur.qty += l.qty;
      cur.taxable += l.taxable * factor;
      cur.value += (l.taxable + l.tax) * factor;
      if (i.order.igst) cur.igst += l.tax * factor;
      else { cur.cgst += (l.tax / 2) * factor; cur.sgst += (l.tax / 2) * factor; }
      m.set(k, cur);
    }
  };
  for (const i of invoices) addHsn(i, 1, true);
  for (const n of notes) addHsn(n, -(n.bill.subtotal ? n.cn.taxable / n.bill.subtotal : 0), false);
  const HSN_HEAD = ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"];
  const hsnRows = (m: Map<string, H>): Cell[][] => [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate).map((h) => [h.hsn, h.desc, h.uqc, h.qty, r2(h.value), h.rate, r2(h.taxable), r2(h.igst), r2(h.cgst), r2(h.sgst), 0]);
  const hsnB2b = hsnRows(hsnMaps.b2b);
  const hsnB2c = hsnRows(hsnMaps.b2c);

  // ---- docs
  const DOCS_HEAD = ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"];
  const allNos = [...invoices.map((i) => i.no), ...cancelled.map((o) => o.invoice_no || `INV-${o.id}`)].sort();
  const docs: Cell[][] = [];
  if (allNos.length) docs.push(["Invoices for outward supply", allNos[0], allNos[allNos.length - 1], allNos.length, cancelled.length]);
  if (notes.length) docs.push(["Credit Note", notes[0].cnNo, notes[notes.length - 1].cnNo, notes.length, 0]);

  // ---- totals, as GSTR-3B 3.1(a) wants them: outward taxable supplies, net of credit notes
  const sum = (f: (h: H) => number) => [...hsnMaps.b2b.values(), ...hsnMaps.b2c.values()].reduce((s, h) => s + f(h), 0);
  const totals = { taxable: r2(sum((h) => h.taxable)), igst: r2(sum((h) => h.igst)), cgst: r2(sum((h) => h.cgst)), sgst: r2(sum((h) => h.sgst)) };
  const invoiceValue = r2(invoices.reduce((s, i) => s + i.bill.total, 0));
  // Plain summaries for the page: by tax rate, by kind of shop, and early-payment discounts
  const rates = new Map<number, { rate: number; taxable: number; tax: number }>();
  for (const h of [...hsnMaps.b2b.values(), ...hsnMaps.b2c.values()]) {
    const cur = rates.get(h.rate) ?? { rate: h.rate, taxable: 0, tax: 0 };
    cur.taxable += h.taxable;
    cur.tax += h.igst + h.cgst + h.sgst;
    rates.set(h.rate, cur);
  }
  const byRate = [...rates.values()].sort((a, b) => a.rate - b.rate).map((x) => ({ rate: x.rate, taxable: r2(x.taxable), tax: r2(x.tax) }));
  const billValue = (b2b: boolean) => r2(invoices.filter((i) => i.b2b === b2b).reduce((s, i) => s + i.bill.total, 0));
  const discounts = r2(notes.reduce((s, n) => s + n.cn.total, 0));

  // Things to fix before filing
  const checks: { tone: "red" | "amber"; text: string; vars?: Record<string, string | number>; href?: string; action?: string }[] = [];
  const badGstin = invoices.filter((i) => !i.b2b && i.customer?.gstin);
  if (badGstin.length) checks.push({ tone: "red", text: "{n} bills went to shops whose GST number looks wrong. Correct it on the shop's page, or they cannot claim the GST back.", vars: { n: badGstin.length }, href: "/customers", action: "Open retailers" });
  const noGstin = new Set(invoices.filter((i) => !i.b2b && !i.customer?.gst_unregistered && !i.customer?.gstin).map((i) => i.order.phone));
  if (noGstin.size) checks.push({ tone: "amber", text: "{n} shops have not given their GST number yet. They are asked on WhatsApp with their next order. Their bills still count; nothing to do.", vars: { n: noGstin.size } });
  const shortHsn = [...hsnMaps.b2b.values(), ...hsnMaps.b2c.values()].filter((h) => h.hsn.replace(/\D/g, "").length < 6);
  if (shortHsn.length) checks.push({ tone: "amber", text: "{n} medicines have a short tax code (HSN). Your accountant may ask for the full 6-digit code.", vars: { n: new Set(shortHsn.map((h) => h.hsn)).size }, href: "/inventory", action: "Open stock" });
  if (!validGstin(storeGstin())) checks.push({ tone: "red", text: "Your own GST number looks wrong. Ask your technical person to correct it before filing." });

  const tbl = (title: string, head: string[], rows: Cell[][]) => {
    const bad = rows.find((r) => r.length !== head.length);
    if (bad) throw new Error(`GSTR-1 ${title}: a row has ${bad.length} columns, the heading ${head.length}`);
    return { title, head, rows };
  };
  const sections = {
    b2b: tbl("b2b", B2B_HEAD, b2b),
    b2cs: tbl("b2cs", B2CS_HEAD, b2cs),
    cdnr: tbl("cdnr", CDNR_HEAD, cdnr),
    "hsn(b2b)": tbl("hsn(b2b)", HSN_HEAD, hsnB2b),
    "hsn(b2c)": tbl("hsn(b2c)", HSN_HEAD, hsnB2c),
    docs: tbl("docs", DOCS_HEAD, docs),
  };
  return {
    period: p, sections, totals, invoiceValue, checks, byRate, discounts,
    value: { withGstin: billValue(true), withoutGstin: billValue(false) },
    counts: { invoices: invoices.length, b2b: invoices.filter((i) => i.b2b).length, b2c: invoices.filter((i) => !i.b2b).length, notes: notes.length, cancelled: cancelled.length, recipients: new Set(invoices.filter((i) => i.b2b).map((i) => i.customer!.gstin)).size },
  };
}

export type Gstr1 = ReturnType<typeof gstr1>;
export type SectionKey = keyof Gstr1["sections"];

/**
 * The workbook in the offline tool's template layout: on each sheet a summary block in rows 1-3, the column
 * headings in row 4 and the data from row 5.
 */
export function gstr1Sheets(r: Gstr1): Sheet[] {
  const sumOf = (rows: Cell[][], i: number) => r2(rows.reduce((s, x) => s + (Number(x[i]) || 0), 0));
  const unique = (rows: Cell[][], i: number) => new Set(rows.map((x) => x[i])).size;
  const s = r.sections;
  const summary: Record<SectionKey, [string, Cell[], Cell[]]> = {
    b2b: ["Summary For B2B, SEZ, DE (4A, 4B, 6B, 6C)", ["No. of Recipients", "", "No. of Invoices", "", "Total Invoice Value", "", "", "", "", "", "", "Total Taxable Value", "Total Cess"], [unique(s.b2b.rows, 0), null, unique(s.b2b.rows, 2), null, r2([...new Map(s.b2b.rows.map((x) => [x[2], Number(x[4])])).values()].reduce((a, b) => a + b, 0)), null, null, null, null, null, null, sumOf(s.b2b.rows, 11), 0]],
    b2cs: ["Summary For B2CS (7)", ["", "", "", "", "Total Taxable Value", "Total Cess", ""], [null, null, null, null, sumOf(s.b2cs.rows, 4), 0, null]],
    cdnr: ["Summary For CDNR (9B)", ["No. of Recipients", "", "No. of Notes", "", "", "", "", "", "Total Note Value", "", "", "Total Taxable Value", "Total Cess"], [unique(s.cdnr.rows, 0), null, unique(s.cdnr.rows, 2), null, null, null, null, null, r2([...new Map(s.cdnr.rows.map((x) => [x[2], Number(x[8])])).values()].reduce((a, b) => a + b, 0)), null, null, sumOf(s.cdnr.rows, 11), 0]],
    "hsn(b2b)": ["Summary For HSN (12) - B2B", ["No. of HSN", "", "", "", "Total Value", "", "Total Taxable Value", "Total Integrated Tax", "Total Central Tax", "Total State/UT Tax", "Total Cess"], [unique(s["hsn(b2b)"].rows, 0), null, null, null, sumOf(s["hsn(b2b)"].rows, 4), null, sumOf(s["hsn(b2b)"].rows, 6), sumOf(s["hsn(b2b)"].rows, 7), sumOf(s["hsn(b2b)"].rows, 8), sumOf(s["hsn(b2b)"].rows, 9), 0]],
    "hsn(b2c)": ["Summary For HSN (12) - B2C", ["No. of HSN", "", "", "", "Total Value", "", "Total Taxable Value", "Total Integrated Tax", "Total Central Tax", "Total State/UT Tax", "Total Cess"], [unique(s["hsn(b2c)"].rows, 0), null, null, null, sumOf(s["hsn(b2c)"].rows, 4), null, sumOf(s["hsn(b2c)"].rows, 6), sumOf(s["hsn(b2c)"].rows, 7), sumOf(s["hsn(b2c)"].rows, 8), sumOf(s["hsn(b2c)"].rows, 9), 0]],
    docs: ["Summary of documents issued during the tax period (13)", ["", "", "", "Total Number", "Total Cancelled"], [null, null, null, sumOf(s.docs.rows, 3), sumOf(s.docs.rows, 4)]],
  };
  return (Object.keys(s) as SectionKey[]).map((k) => {
    const [title, sh, sv] = summary[k];
    return { name: k, rows: [[title], sh, sv, s[k].head, ...s[k].rows], bold: [0, 1, 3], widths: s[k].head.map((h) => Math.max(12, Math.min(34, h.length + 4))) };
  });
}
