import type { NextRequest } from "next/server";
import { markPaid } from "@/lib/orders";
import { validRazorpaySignature } from "@/lib/razorpay";

type Event = {
  event: string;
  payload?: {
    payment_link?: { entity?: { notes?: { order_id?: string } } };
    payment?: { entity?: { id?: string; amount?: number } };
  };
};

/** Razorpay webhook: subscribe to `payment_link.paid` and point it at /api/razorpay. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!validRazorpaySignature(raw, req.headers.get("x-razorpay-signature"))) return new Response("Bad signature", { status: 401 });
  const ev = JSON.parse(raw) as Event;
  if (ev.event === "payment_link.paid") {
    const orderId = Number(ev.payload?.payment_link?.entity?.notes?.order_id);
    const paise = ev.payload?.payment?.entity?.amount;
    // The link was made for the discounted price of its day; record exactly what was paid. No-op if already paid.
    if (orderId) await markPaid(orderId, ev.payload?.payment?.entity?.id ?? null, paise ? paise / 100 : undefined);
  }
  return new Response("ok", { status: 200 });
}
