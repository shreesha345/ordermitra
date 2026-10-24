import { isInterState } from "./billing";
import { db, type Customer } from "./db";
import { cleanGstin, gstinProblem, stateName } from "./gstin";
import { t, type Lang } from "./i18n";
import { step } from "./trace";
import { sendText } from "./whatsapp";

// Retailers' GSTINs, asked for on WhatsApp: with one, their bills are B2B on the GST return (they can claim the
// input tax credit); without one they are B2C. Asked at most once a week, never once they have answered.

const ASK_AGAIN = 7 * 86_400_000;

/** Saves a valid GSTIN and re-works CGST+SGST or IGST on orders not billed yet. Returns what was wrong otherwise. */
export function saveGstin(phone: string, raw: string): string | null {
  const g = cleanGstin(raw);
  const problem = gstinProblem(g);
  if (problem) return problem;
  const d = db();
  d.prepare("UPDATE customers SET gstin = ?, gst_unregistered = 0 WHERE phone = ?").run(g, phone);
  d.prepare("UPDATE orders SET igst = ? WHERE phone = ? AND billed_at IS NULL AND status != 'cancelled'").run(isInterState(g) ? 1 : 0, phone);
  step("gst", `Saved GSTIN ${g}`, stateName(g), "good");
  return null;
}

/** After an order card: ask for the GSTIN if we do not have it and have not asked this week. */
export async function maybeAskGstin(c: Customer | undefined, lang: Lang) {
  if (!c || c.gstin || c.gst_unregistered || (c.gst_asked_at && Date.now() - c.gst_asked_at < ASK_AGAIN)) return;
  db().prepare("UPDATE customers SET gst_asked_at = ? WHERE phone = ?").run(Date.now(), c.phone);
  step("gst", "Asked for the GSTIN", "Needed to file their bills as B2B on the GST return");
  await sendText(c.phone, t(lang, "askGstin"), [{ id: "nogst", title: t(lang, "noGstBtn") }]);
}

/** A message that is (or contains) a GSTIN. Returns true when it was handled and needs no other reply. */
export async function handleGstinText(phone: string, text: string, lang: Lang) {
  const g = cleanGstin(text).match(/\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}/)?.[0];
  if (!g) return false;
  const problem = saveGstin(phone, g);
  if (problem) await sendText(phone, t(lang, "gstBad", { gstin: g }));
  else await sendText(phone, t(lang, "gstSaved", { gstin: g, state: stateName(g) }));
  // Just the number: done. A longer message (an order with the GSTIN in it) still goes to the agent.
  return text.replace(/[^A-Za-z0-9]/g, "").length <= 20;
}

export function markUnregistered(phone: string) {
  db().prepare("UPDATE customers SET gst_unregistered = 1 WHERE phone = ?").run(phone);
  step("gst", "Retailer has no GSTIN", "Their bills go on the GST return as B2C");
}
