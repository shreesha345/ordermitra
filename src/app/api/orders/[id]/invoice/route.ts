import { connection, type NextRequest } from "next/server";
import { allowed } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildInvoice } from "@/lib/invoice";

// Opened from the dashboard, or by WhatsApp with the order's random key (?k=), so bills cannot be read by guessing numbers.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/orders/[id]/invoice">) {
  await connection();
  const { id } = await ctx.params;
  const k = req.nextUrl.searchParams.get("k");
  const token = (db().prepare("SELECT view_token FROM orders WHERE id = ?").get(Number(id)) as { view_token: string | null } | undefined)?.view_token;
  if (!(k ? !!token && k === token : allowed(req.headers))) return new Response("Not found", { status: 404 });
  const pdf = await buildInvoice(Number(id));
  if (!pdf) return new Response("No invoice for this order yet", { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Invoice-${id}.pdf"` },
  });
}
