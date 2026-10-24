import type { NextRequest } from "next/server";
import { isInterState } from "@/lib/billing";
import { db } from "@/lib/db";
import { cleanGstin, gstinProblem } from "@/lib/gstin";

/** Updates a retailer's licence, GSTIN, city and credit limit. A licence only counts once someone ticks "checked". */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/customers/[phone]">) {
  const { phone } = await ctx.params;
  const b = (await req.json()) as {
    city?: string; drug_licence?: string; licence_forms?: string; licence_expiry?: string; verified?: boolean; gstin?: string; credit_limit?: number;
  };
  const limit = Number(b.credit_limit);
  if (!Number.isFinite(limit) || limit < 0) return Response.json({ error: "Credit limit must be a positive number" }, { status: 400 });
  const gstin = cleanGstin(b.gstin ?? "");
  const bad = gstin && gstinProblem(gstin);
  if (bad) return Response.json({ error: `GSTIN: ${bad}` }, { status: 400 });
  const r = db()
    .prepare(
      `UPDATE customers SET city = ?, drug_licence = ?, licence_forms = ?, licence_expiry = ?, gstin = ?, credit_limit = ?,
       licence_status = CASE WHEN ? = '' THEN 'none' WHEN ? THEN 'verified' WHEN licence_status = 'verified' THEN 'none' ELSE licence_status END
       WHERE phone = ?`,
    )
    .run(
      (b.city ?? "").trim(), (b.drug_licence ?? "").trim(), (b.licence_forms ?? "").trim(), /^\d{4}-\d{2}-\d{2}$/.test(b.licence_expiry ?? "") ? b.licence_expiry! : null,
      gstin, limit, (b.drug_licence ?? "").trim(), b.verified ? 1 : 0, phone,
    );
  if (!r.changes) return Response.json({ error: "Retailer not found" }, { status: 404 });
  // CGST+SGST or IGST follows the GSTIN's state on orders not billed yet
  db().prepare("UPDATE orders SET igst = ? WHERE phone = ? AND billed_at IS NULL AND status != 'cancelled'").run(isInterState(gstin) ? 1 : 0, phone);
  return Response.json({ ok: true });
}
