import { payable, unpaidBills } from "./billing";
import { db, type Customer } from "./db";
import { normLang } from "./i18n";
import { regularItems } from "./insights";
import { sendDues, sendReorderNudge } from "./tools";
import { step, withTrace } from "./trace";

// Messages the assistant sends first: payment reminders and "time to restock" nudges.
// On real WhatsApp, a message more than 24 hours after the retailer last wrote needs an approved template.

export type Kind = "dues" | "reorder";

/** Who would get each kind of message right now. */
export function targets(kind: Kind): Customer[] {
  const all = db().prepare("SELECT * FROM customers ORDER BY name").all() as Customer[];
  return kind === "dues"
    ? all.filter((c) => unpaidBills(c.phone).some((b) => payable(b).overdueDays > 0))
    : all.filter((c) => regularItems(c.phone).some((r) => r.dueAgain));
}

export async function remind(kind: Kind, phones?: string[]) {
  const list = phones?.length
    ? (phones.map((p) => db().prepare("SELECT * FROM customers WHERE phone = ?").get(p)).filter(Boolean) as Customer[])
    : targets(kind);
  let sent = 0;
  for (const c of list) {
    const ok = await withTrace(c.phone, kind === "dues" ? "Payment reminder from the dashboard" : "Reorder reminder from the dashboard", async () => {
      const done = kind === "dues" ? await sendDues(c.phone, normLang(c.language), true) : await sendReorderNudge(c.phone, normLang(c.language));
      step(kind === "dues" ? "account" : "history", done ? (kind === "dues" ? "Sent dues with Pay buttons at today's discounted price" : "Sent a restock reminder with an Order these button") : "Nothing to send", undefined, done ? "good" : undefined);
      return done;
    });
    if (ok) sent++;
  }
  return sent;
}
