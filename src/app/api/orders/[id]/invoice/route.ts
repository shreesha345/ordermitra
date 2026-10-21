import { connection, type NextRequest } from "next/server";
import { buildInvoice } from "@/lib/invoice";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/orders/[id]/invoice">) {
  await connection();
  const { id } = await ctx.params;
  const pdf = await buildInvoice(Number(id));
  if (!pdf) return new Response("No invoice for this order yet", { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Invoice-${id}.pdf"` },
  });
}
