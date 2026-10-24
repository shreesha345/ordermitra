import type { NextRequest } from "next/server";
import { cancelOrder, dispatchOrder, markPaid, reviewOrder } from "@/lib/orders";

/**
 * Seller actions on an order:
 * - mark_paid: a UPI payment, or a credit bill paid by cash, cheque or transfer. The prompt-payment discount
 *   for today is applied unless `amount` says what was actually received.
 * - approve_credit / approve_pay_first / deny: the decision on an order held for review.
 * - dispatch: out for delivery (only once paid or taken on credit).
 * - cancel: releases any reserved stock.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/orders/[id]">) {
  const { id } = await ctx.params;
  const { action, ref, amount } = (await req.json()) as { action?: string; ref?: string; amount?: number };
  const orderId = Number(id);
  const received = amount === undefined || amount === null || String(amount) === "" ? undefined : Number(amount);
  if (received !== undefined && (!Number.isFinite(received) || received <= 0)) return Response.json({ error: "Amount must be a positive number" }, { status: 400 });
  const ok =
    action === "mark_paid"
      ? await markPaid(orderId, ref?.trim() || `PAY${Date.now().toString().slice(-8)}`, received)
      : action === "approve_credit"
        ? await reviewOrder(orderId, "credit")
        : action === "approve_pay_first"
          ? await reviewOrder(orderId, "pay_first")
          : action === "deny"
            ? await reviewOrder(orderId, "deny")
            : action === "dispatch"
              ? await dispatchOrder(orderId)
              : action === "cancel"
                ? await cancelOrder(orderId)
                : null;
  if (ok === null) return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json({ ok });
}
