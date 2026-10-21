import type { NextRequest } from "next/server";
import { cancelOrder, commit } from "@/lib/orders";

/** Seller actions: mark a UPI payment as received, or cancel (which releases reserved stock). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/orders/[id]">) {
  const { id } = await ctx.params;
  const { action, ref } = (await req.json()) as { action?: string; ref?: string };
  const orderId = Number(id);
  const ok =
    action === "mark_paid"
      ? await commit(orderId, "upi", ref?.trim() || `UPI${Date.now().toString().slice(-8)}`)
      : action === "cancel"
        ? await cancelOrder(orderId)
        : null;
  if (ok === null) return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json({ ok });
}
