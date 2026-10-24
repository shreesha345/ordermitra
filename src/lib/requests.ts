import { db, type Request } from "./db";
import { normLang, t } from "./i18n";
import { sendText } from "./whatsapp";

// What the team does with things the assistant handed over: returns, licences and callbacks.

export type ReturnLine = { said: string; name: string; item_id: number | null; qty: number; batch: string; expiry: string; reason: string; rate: number; sold_by_us: boolean | null };
export type LicenceDetails = { licence_no: string; forms: string; holder: string; address: string; valid_until: string; gstin: string };

export const getRequest = (id: number) => db().prepare("SELECT * FROM requests WHERE id = ?").get(id) as Request | undefined;

export async function closeRequest(id: number, action: "approve" | "reject" | "done") {
  const r = getRequest(id);
  if (!r || r.status !== "open") return false;
  const d = db();
  const lang = normLang((d.prepare("SELECT language FROM customers WHERE phone = ?").get(r.phone) as { language: string } | undefined)?.language);
  const status = action === "approve" ? (r.kind === "callback" ? "done" : "approved") : action === "reject" ? "rejected" : "done";
  d.prepare("UPDATE requests SET status = ?, closed_at = ? WHERE id = ?").run(status, Date.now(), id);

  if (r.kind === "return") {
    await sendText(r.phone, t(lang, status === "approved" ? "returnApproved" : "returnRejected", { id }));
  } else if (r.kind === "licence") {
    const l = JSON.parse(r.details) as LicenceDetails;
    if (status === "approved") {
      d.prepare("UPDATE customers SET drug_licence = ?, licence_forms = ?, licence_expiry = ?, licence_status = 'verified' WHERE phone = ?").run(
        l.licence_no, l.forms, /^\d{4}-\d{2}-\d{2}$/.test(l.valid_until) ? l.valid_until : null, r.phone,
      );
      await sendText(r.phone, t(lang, "licenceVerified"));
    } else {
      d.prepare("UPDATE customers SET licence_status = 'rejected' WHERE phone = ?").run(r.phone);
      await sendText(r.phone, t(lang, "licenceRejected"));
    }
  }
  return true;
}
