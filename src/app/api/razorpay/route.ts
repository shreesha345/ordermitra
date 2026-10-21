import type { NextRequest } from "next/server";
import { commit } from "@/lib/orders";
import { validRazorpaySignature } from "@/lib/razorpay";

type Event = {
  event: string;
  payload?: {
    payment_link?: { entity?: { notes?: { order_id?: string } } };
    payment?: { entity?: { id?: string } };
  };
};

/** Razorpay webhook: subscribe to `payment_link.paid` and point it at /api/razorpay. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!validRazorpaySignature(raw, req.headers.get("x-razorpay-signature"))) return new Response("Bad signature", { status: 401 });
  const ev = JSON.parse(raw) as Event;
  if (ev.event === "payment_link.paid") {
    const orderId = Number(ev.payload?.payment_link?.entity?.notes?.order_id);
    if (orderId) await commit(orderId, "upi", ev.payload?.payment?.entity?.id ?? null); // no-op if already paid
  }
  return new Response("ok", { status: 200 });
}
