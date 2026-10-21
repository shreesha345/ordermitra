import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, type Order } from "./db";
import { getLines, getOrder } from "./orders";

const store = () => ({
  name: process.env.STORE_NAME ?? "Sri Ram Medicals",
  address: process.env.STORE_ADDRESS ?? "12, Market Road, Mangaluru 575001",
  licence: process.env.STORE_DRUG_LICENCE ?? "KA-MNG-20B/21B-1234",
  gstin: process.env.STORE_GSTIN ?? "29ABCDE1234F1Z5",
});

// Standard PDF fonts have no rupee glyph, so amounts are printed as "Rs."
const rs = (n: number) => "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Latin-only text; standard PDF fonts cannot draw Indic scripts. */
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");

export async function buildInvoice(orderId: number): Promise<Uint8Array | null> {
  const order = getOrder(orderId) as Order | undefined;
  if (!order || order.total <= 0) return null;
  const lines = getLines(orderId).filter((l) => l.qty_confirmed > 0);
  const customer = db().prepare("SELECT name FROM customers WHERE phone = ?").get(order.phone) as { name: string } | undefined;
  const s = store();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.09, 0.12);
  const muted = rgb(0.37, 0.42, 0.48);
  const blue = rgb(0.11, 0.43, 0.95);
  const L = 48;
  const R = 547;

  const text = (t: string, x: number, y: number, size = 10, f = font, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, x: number, y: number, size = 10, f = font, color = ink) =>
    page.drawText(safe(t), { x: x - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color });
  const rule = (y: number) => page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.7, color: rgb(0.89, 0.9, 0.92) });

  let y = 790;
  text(s.name, L, y, 20, bold);
  right("TAX INVOICE", R, y + 2, 14, bold, blue);
  y -= 16;
  text(s.address, L, y, 9, font, muted);
  right(`INV-${orderId}`, R, y, 11, bold);
  y -= 13;
  text(`Drug Licence ${s.licence}  |  GSTIN ${s.gstin}`, L, y, 9, font, muted);
  right(new Date(order.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), R, y, 9, font, muted);
  y -= 18;
  rule(y);

  y -= 22;
  text("BILL TO", L, y, 8, bold, muted);
  y -= 15;
  text(customer?.name ?? "+" + order.phone, L, y, 12, bold);
  y -= 14;
  text(`+${order.phone}  |  Ordered via WhatsApp`, L, y, 9, font, muted);

  y -= 30;
  page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 22, color: rgb(0.96, 0.97, 0.98) });
  text("Item", L + 8, y, 9, bold, muted);
  right("Qty", 360, y, 9, bold, muted);
  right("Rate", 450, y, 9, bold, muted);
  right("Amount", R - 8, y, 9, bold, muted);
  y -= 26;
  for (const l of lines) {
    text(l.name, L + 8, y, 10);
    right(String(l.qty_confirmed), 360, y);
    right(rs(l.unit_price), 450, y);
    right(rs(l.qty_confirmed * l.unit_price), R - 8, y);
    y -= 8;
    rule(y);
    y -= 18;
  }

  y -= 6;
  const row = (label: string, value: string, big = false) => {
    text(label, 340, y, big ? 12 : 10, big ? bold : font, big ? ink : muted);
    right(value, R - 8, y, big ? 13 : 10, big ? bold : font);
    y -= big ? 22 : 17;
  };
  row("Subtotal", rs(order.subtotal));
  row("GST (5%)", rs(order.gst));
  row("Delivery", "Free");
  page.drawLine({ start: { x: 340, y: y + 12 }, end: { x: R, y: y + 12 }, thickness: 0.7, color: rgb(0.89, 0.9, 0.92) });
  y -= 4;
  row("Total", rs(order.total), true);

  y -= 12;
  const paid = order.status === "paid";
  const label = paid
    ? `PAID online  |  Ref ${order.pay_ref ?? "-"}`
    : order.status === "confirmed_cod"
      ? "ORDER CONFIRMED  |  Pay on delivery"
      : "PAYMENT PENDING";
  page.drawRectangle({ x: L, y: y - 10, width: R - L, height: 32, color: paid ? rgb(0.89, 0.97, 0.92) : rgb(0.99, 0.95, 0.88) });
  text(label, L + 14, y + 2, 10, bold, paid ? rgb(0.07, 0.63, 0.31) : rgb(0.72, 0.47, 0.12));

  text(`Generated automatically by Intova  |  Thank you for shopping with ${s.name}`, L, 48, 8, font, muted);
  return pdf.save();
}
