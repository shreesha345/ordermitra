import { stateName } from "./gstin";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { amountInWords, computeBill, creditDays, creditNote, invoiceNo, payable, round2, tiers } from "./billing";
import { appName, store } from "./brand";
import { db, type Customer } from "./db";
import { LOGO } from "./logo";
import { getLines, getOrder } from "./orders";

// GST tax invoice for one bill, A4, with what Rule 46 of the CGST Rules asks for (serial number per
// financial year, both GSTINs, place of supply with state code, HSN, rate and amount of tax, reverse charge,
// signatory) and what a pharma bill carries (drug licences, manufacturer, batch, expiry, MRP).
// Amounts come from computeBill, the same code that priced the WhatsApp messages and the payment link.

// Standard PDF fonts have no rupee glyph, so amounts are printed as "Rs."
const rs = (n: number) => "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n2 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (at: number) => new Date(at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const DAY = 86_400_000;

/** Latin-only text; standard PDF fonts cannot draw Indic scripts. */
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");

export async function buildInvoice(orderId: number): Promise<Uint8Array | null> {
  const order = getOrder(orderId);
  if (!order || order.total <= 0) return null;
  const billedAt = order.billed_at ?? order.created_at; // bills made before billed_at was recorded
  const lines = getLines(orderId);
  const bill = computeBill(lines, order.igst === 1);
  const d = db();
  const c = d.prepare("SELECT * FROM customers WHERE phone = ?").get(order.phone) as Customer | undefined;
  const s = store();
  const inv = invoiceNo(order);
  // Pack, manufacturer and MRP per line, from the product and the batch that was billed
  const extra = (itemId: number | null, batch: string) => {
    if (!itemId) return { unit: "", mfr: "", mrp: 0 };
    const i = d.prepare("SELECT unit, mfr FROM items WHERE id = ?").get(itemId) as { unit: string; mfr: string } | undefined;
    const b = d.prepare("SELECT mrp FROM batches WHERE item_id = ? AND batch = ?").get(itemId, batch) as { mrp: number } | undefined;
    return { unit: i?.unit ?? "", mfr: i?.mfr ?? "", mrp: b?.mrp ?? 0 };
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Tax invoice ${inv}`);
  pdf.setAuthor(s.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.36, 0.42, 0.49);
  const line = rgb(0.85, 0.87, 0.9);
  const blue = rgb(0.12, 0.37, 0.84);
  const shade = rgb(0.95, 0.96, 0.98);
  const L = 32;
  const R = 563;

  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 0;
  const text = (t: string, x: number, yy: number, size = 8.5, f: PDFFont = font, color = ink) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, x: number, yy: number, size = 8.5, f: PDFFont = font, color = ink) =>
    page.drawText(safe(t), { x: x - f.widthOfTextAtSize(safe(t), size), y: yy, size, font: f, color });
  /** Cuts text to fit a width, with a tilde. */
  const fit = (t: string, w: number, size: number, f: PDFFont = font) => {
    let out = safe(t);
    while (out.length > 1 && f.widthOfTextAtSize(out, size) > w) out = out.slice(0, -2) + "~";
    return out;
  };
  const rule = (yy: number, x1 = L, x2 = R, color = line) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color });
  const label = (t: string, x: number, yy: number) => text(t.toUpperCase(), x, yy, 6.5, bold, muted);

  // ---- header: seller and invoice details ---------------------------------
  const header = (first: boolean) => {
    y = 808;
    page.drawSvgPath(LOGO.tile, { x: L, y: y + 12, scale: 0.85, color: blue });
    page.drawSvgPath(LOGO.bubble, { x: L, y: y + 12, scale: 0.85, color: rgb(1, 1, 1) });
    page.drawSvgPath(LOGO.cross, { x: L, y: y + 12, scale: 0.85, color: blue });
    text(s.name, L + 36, y - 2, 15, bold);
    right("TAX INVOICE", R, y, 13, bold, blue);
    right("Original for recipient", R, y - 12, 7, font, muted);
    y -= 14;
    text(s.address, L + 36, y, 8, font, muted);
    y -= 10;
    text(`GSTIN ${s.gstin}  |  State ${stateName(s.gstin)}`, L + 36, y, 8, font, muted);
    y -= 10;
    text([`Drug Lic. ${s.licence}`, s.phone && `Ph ${s.phone}`, s.email].filter(Boolean).join("  |  "), L + 36, y, 8, font, muted);
    y -= 10;
    rule(y, L, R, ink);
    if (!first) {
      y -= 14;
      text(`${inv} (continued)`, L, y, 8.5, bold);
      y -= 6;
    }
  };
  header(true);

  // Three boxes: invoice details, billed to, shipped to
  y -= 14;
  const top = y;
  const col = [L, L + 180, L + 365];
  label("Invoice details", col[0], y);
  label("Billed to", col[1], y);
  label("Shipped to", col[2], y);
  const kv = (k: string, v: string, x: number, yy: number) => {
    text(k, x, yy, 7.5, font, muted);
    text(fit(v, 105, 8, bold), x + 68, yy, 8, bold);
  };
  y -= 12;
  kv("Invoice no.", inv, col[0], y);
  kv("Invoice date", date(billedAt), col[0], y - 11);
  kv("Order ref.", `#${order.id} on WhatsApp`, col[0], y - 22);
  kv("Place of supply", stateName(c?.gstin || s.gstin), col[0], y - 33);
  kv("Reverse charge", "No", col[0], y - 44);
  kv("Due date", date(payable(order, billedAt).dueAt), col[0], y - 55);

  const party = (x: number) => {
    let yy = y;
    text(fit(c?.name ?? `+${order.phone}`, 175, 9.5, bold), x, yy, 9.5, bold);
    yy -= 11;
    for (const t of [
      c?.city || "",
      `State: ${stateName(c?.gstin || s.gstin)}`,
      `GSTIN: ${c?.gstin || "Unregistered"}`,
      `Drug Lic.: ${c?.drug_licence || "Not on file"}`,
      `Ph: +${order.phone}`,
    ].filter(Boolean)) {
      text(fit(t, 175, 8), x, yy, 8, font, ink);
      yy -= 11;
    }
  };
  party(col[1]);
  party(col[2]);
  y = top - 74;
  rule(y);

  // ---- line items ---------------------------------------------------------
  // x positions: text columns are left-aligned at their x, number columns right-aligned at their x
  const X = { no: L + 2, item: L + 16, hsn: 190, batch: 228, exp: 276, qty: 322, mrp: 360, rate: 398, taxable: 446, gst: 470, tax: 512, amount: R - 2 };
  const tableHead = () => {
    page.drawRectangle({ x: L, y: y - 18, width: R - L, height: 22, color: shade });
    const h = y - 8;
    text("#", X.no, h, 7, bold, muted);
    text("Product (Mfr, pack)", X.item, h, 7, bold, muted);
    text("HSN", X.hsn, h, 7, bold, muted);
    text("Batch", X.batch, h, 7, bold, muted);
    text("Exp.", X.exp, h, 7, bold, muted);
    right("Qty", X.qty, h, 7, bold, muted);
    right("MRP", X.mrp, h, 7, bold, muted);
    right("Rate", X.rate, h, 7, bold, muted);
    right("Taxable", X.taxable, h, 7, bold, muted);
    right("GST%", X.gst, h, 7, bold, muted);
    right(order.igst ? "IGST" : "GST amt", X.tax, h, 7, bold, muted);
    right("Amount", X.amount, h, 7, bold, muted);
    y -= 32;
  };
  y -= 8;
  tableHead();
  let units = 0;
  bill.lines.forEach((l, i) => {
    if (y < 110) {
      text("Continued on the next page", L, 52, 7.5, font, muted);
      page = pdf.addPage([595, 842]);
      header(false);
      y -= 8;
      tableHead();
    }
    const x = extra(l.itemId, l.batch);
    units += l.qty;
    text(String(i + 1), X.no, y, 8, font, muted);
    text(fit(l.name, X.hsn - X.item - 6, 8.5, bold), X.item, y, 8.5, bold);
    text(fit(l.hsn || "-", X.batch - X.hsn - 3, 7.5), X.hsn, y, 7.5);
    text(fit(l.batch || "-", X.exp - X.batch - 3, 7.5), X.batch, y, 7.5);
    text(l.expiry ? new Date(l.expiry).toLocaleDateString("en-IN", { month: "2-digit", year: "2-digit" }) : "-", X.exp, y, 7.5);
    right(String(l.qty), X.qty, y, 8);
    right(x.mrp ? n2(x.mrp) : "-", X.mrp, y, 7.5, font, muted);
    right(n2(l.rate), X.rate, y, 8);
    right(n2(l.taxable), X.taxable, y, 8);
    right(`${l.gstRate}%`, X.gst, y, 8);
    right(n2(l.tax), X.tax, y, 8);
    right(n2(l.amount), X.amount, y, 8, bold);
    const sub = [x.mfr, x.unit].filter(Boolean).join(", ");
    if (sub) text(fit(sub, X.hsn - X.item - 6, 6.5), X.item, y - 9, 6.5, font, muted);
    y -= sub ? 15 : 8;
    rule(y);
    y -= 12;
  });
  // Totals row of the table
  page.drawRectangle({ x: L, y: y - 4, width: R - L, height: 15, color: shade });
  text(`${bill.lines.length} item${bill.lines.length === 1 ? "" : "s"}`, X.item, y, 8, bold);
  right(String(units), X.qty, y, 8, bold);
  right(n2(bill.subtotal), X.taxable, y, 8, bold);
  right(n2(bill.gst), X.tax, y, 8, bold);
  right(n2(bill.total), X.amount, y, 8, bold);
  y -= 22;

  // ---- HSN-wise tax summary, and totals -----------------------------------
  if (y < 300) {
    text("Continued on the next page", L, 52, 7.5, font, muted);
    page = pdf.addPage([595, 842]);
    header(false);
    y -= 14;
  }
  const hsn = new Map<string, { hsn: string; rate: number; taxable: number; tax: number }>();
  for (const l of bill.lines) {
    const key = `${l.hsn}|${l.gstRate}`;
    const h = hsn.get(key) ?? { hsn: l.hsn || "-", rate: l.gstRate, taxable: 0, tax: 0 };
    h.taxable = round2(h.taxable + l.taxable);
    h.tax = round2(h.tax + l.tax);
    hsn.set(key, h);
  }
  const sumTop = y;
  label("Tax summary by HSN", L, y);
  y -= 12;
  const T = order.igst
    ? { cols: [L, L + 75, L + 140, L + 200, L + 260], heads: ["HSN", "Rate", "Taxable", "IGST", "Total tax"] }
    : { cols: [L, L + 70, L + 135, L + 180, L + 225, L + 270], heads: ["HSN", "Taxable", "CGST %", "CGST", "SGST %", "SGST"] };
  T.heads.forEach((h, i) => (i ? right(h, T.cols[i], y, 7, bold, muted) : text(h, T.cols[i], y, 7, bold, muted)));
  y -= 4;
  rule(y, L, T.cols[T.cols.length - 1]);
  y -= 10;
  for (const h of [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)) {
    // CGST and SGST are each half of the tax, as on every line
    const half = round2(h.tax / 2);
    const vals = order.igst
      ? [h.hsn, `${h.rate}%`, n2(h.taxable), n2(h.tax), n2(h.tax)]
      : [h.hsn, n2(h.taxable), `${h.rate / 2}%`, n2(half), `${h.rate / 2}%`, n2(round2(h.tax - half))];
    vals.forEach((v, i) => (i ? right(v, T.cols[i], y, 8) : text(v, T.cols[i], y, 8)));
    y -= 11;
  }
  y -= 4;
  text(`Tax in words: ${amountInWords(bill.gst)}`, L, y, 7.5, font, muted);

  let ty = sumTop;
  const totalRow = (k: string, v: string, big = false) => {
    text(k, 375, ty, big ? 10.5 : 8.5, big ? bold : font, big ? ink : muted);
    right(v, R - 2, ty, big ? 11 : 8.5, big ? bold : font);
    ty -= big ? 18 : 13;
  };
  totalRow("Taxable value", rs(bill.subtotal));
  if (order.igst) totalRow("IGST", rs(bill.gst));
  else {
    const cg = round2(bill.slabs.reduce((a, x) => a + x.cgst, 0));
    totalRow("CGST", rs(cg));
    totalRow("SGST", rs(round2(bill.gst - cg)));
  }
  rule(ty + 8, 375, R, ink);
  ty -= 4;
  totalRow("Invoice total", rs(bill.total), true);

  y = Math.min(y, ty) - 10;
  text(`Amount in words: ${amountInWords(bill.total)}`, L, y, 8.5, bold);

  // ---- payment terms, or receipt --------------------------------------------
  y -= 18;
  const boxTop = y + 10;
  const paid = order.status === "paid";
  const box: { t: string; b?: boolean }[] = [];
  if (paid) {
    const cn = creditNote(order);
    box.push({ t: `PAID ${rs(order.paid_amount || order.total)} on ${date(order.paid_at ?? order.updated_at)}  |  Ref ${order.pay_ref ?? "-"}`, b: true });
    if (order.discount > 0) box.push({ t: `Prompt-payment discount ${rs(cn.total)} issued as credit note CN-${inv.replace(/^\w+\//, "")} (taxable value ${rs(cn.taxable)}, GST ${rs(cn.gst)}).` });
  } else {
    const p = payable(order, billedAt);
    box.push({ t: `PAYMENT TERMS: ${creditDays()} days credit, due by ${date(p.dueAt)}. Pay early and save:`, b: true });
    for (const tier of tiers()) {
      const amt = round2(bill.total - round2((bill.total * tier.pct) / 100)); // exactly as payable() works it out
      box.push({ t: `  Paid by ${date(billedAt + tier.days * DAY)}: ${tier.pct}% off, pay ${rs(amt)}` });
    }
    box.push({ t: "  The discount is given as a credit note against this invoice when the payment is received." });
    if (order.status === "confirmed_cod") box.push({ t: "Goods supplied on credit." });
  }
  const payTo = [s.upi && `UPI ${s.upi}`, s.bank].filter(Boolean).join("  |  ");
  if (payTo && !paid) box.push({ t: `Pay to: ${payTo}` });
  const h = box.length * 11.5 + 12;
  page.drawRectangle({ x: L, y: boxTop - h, width: R - L, height: h, color: paid ? rgb(0.89, 0.96, 0.92) : rgb(0.92, 0.95, 0.99) });
  let ly = boxTop - 14;
  for (const l of box) {
    text(l.t, L + 10, ly, 8, l.b ? bold : font, paid ? rgb(0.07, 0.5, 0.29) : l.b ? blue : ink);
    ly -= 11.5;
  }
  y = boxTop - h - 16;

  // ---- declaration, terms and signatory -------------------------------------
  if (y < 120) {
    page = pdf.addPage([595, 842]);
    header(false);
    y -= 20;
  }
  const city = s.address.split(",").map((p) => p.trim().replace(/\s*\d{6}$/, "")).filter(Boolean).pop() ?? "";
  label("Declaration", L, y);
  label(`For ${s.name}`, 420, y);
  y -= 11;
  for (const t of [
    "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    "Goods once sold are taken back only as per our returns policy, against the same batch.",
    `E. & O.E.${city ? `  Subject to ${city} jurisdiction.` : ""}`,
  ]) {
    text(fit(t, 370, 7), L, y, 7, font, muted);
    y -= 10;
  }
  rule(y - 14, 420, R, ink);
  text("Authorised signatory", 420, y - 24, 7.5, font, muted);

  // ---- footer on every page -------------------------------------------------
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: L, y: 44 }, end: { x: R, y: 44 }, thickness: 0.6, color: line });
    p.drawText(safe(`${inv}  |  This is a computer-generated invoice, produced by ${appName()}.`), { x: L, y: 32, size: 7, font, color: muted });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: R - font.widthOfTextAtSize(pg, 7), y: 32, size: 7, font, color: muted });
  });
  return pdf.save();
}
