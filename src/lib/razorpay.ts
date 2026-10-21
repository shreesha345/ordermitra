import { createHmac, timingSafeEqual } from "node:crypto";

export const razorpayLive = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

type PaymentLink = { id: string; short_url: string };

/** Creates a Razorpay Payment Link (UPI, cards, netbanking) for one order. Amount is in rupees. */
export async function createPaymentLink(o: { id: number; total: number; phone: string; name?: string | null }): Promise<PaymentLink> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.round(o.total * 100),
      currency: "INR",
      accept_partial: false,
      reference_id: `order-${o.id}-${Date.now()}`,
      description: `${process.env.STORE_NAME ?? "Sri Ram Medicals"} order #${o.id}`,
      customer: { name: o.name ?? undefined, contact: `+${o.phone}` },
      notify: { sms: false, email: false },
      notes: { order_id: String(o.id) },
      expire_by: Math.floor(Date.now() / 1000) + 24 * 3600,
    }),
  });
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${await res.text()}`);
  return (await res.json()) as PaymentLink;
}

/**
 * Local-dev stand-in for the webhook: asks Razorpay every few seconds whether the link was paid,
 * so payments are picked up without a public URL. Gives up after 30 minutes.
 */
export function watchPaymentLink(linkId: string, onPaid: (paymentId: string | null) => unknown) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const stopAt = Date.now() + 30 * 60_000;
  const tick = async () => {
    try {
      const res = await fetch(`https://api.razorpay.com/v1/payment_links/${linkId}`, { headers: { Authorization: `Basic ${auth}` } });
      if (res.ok) {
        const pl = (await res.json()) as { status: string; payments?: { payment_id: string }[] };
        if (pl.status === "paid") return void (await onPaid(pl.payments?.[0]?.payment_id ?? null));
        if (pl.status === "cancelled" || pl.status === "expired") return;
      }
    } catch (e) {
      console.error("razorpay poll failed", linkId, e);
    }
    if (Date.now() < stopAt) setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
}

/** Razorpay signs the raw webhook body with HMAC-SHA256 using the webhook secret. */
export function validRazorpaySignature(raw: string, header: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
