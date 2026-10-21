import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import type { Media } from "./gemini";

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v21.0"}`;

export type Button = { id: string; title: string };

export const whatsappLive = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

function log(phone: string, direction: "in" | "out", kind: string, body: string, buttons?: Button[], docUrl?: string) {
  db()
    .prepare("INSERT INTO messages (phone, direction, kind, body, buttons, doc_url, at) VALUES (?,?,?,?,?,?,?)")
    .run(phone, direction, kind, body, buttons ? JSON.stringify(buttons) : null, docUrl ?? null, Date.now());
}

export const logIncoming = (phone: string, kind: string, body: string) => log(phone, "in", kind, body);

async function post(payload: object) {
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  if (!res.ok) console.error("WhatsApp send failed", res.status, await res.text());
  return res.ok;
}

// WhatsApp allows at most 3 reply buttons, each title up to 20 characters.
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Text, optionally with up to 3 quick-reply buttons. Always recorded so the dashboard can show the chat. */
export async function sendText(phone: string, body: string, buttons?: Button[]) {
  log(phone, "out", buttons?.length ? "buttons" : "text", body, buttons);
  if (!whatsappLive()) return;
  if (!buttons?.length) return post({ to: phone, type: "text", text: { body } });
  await post({
    to: phone,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: clip(b.title, 20) } })) },
    },
  });
}

/** The language card: a list message, since reply buttons stop at 3 and we offer 5 languages. */
export async function sendLanguageCard(phone: string) {
  const rows = [
    { id: "lang:en", title: "English" },
    { id: "lang:hi", title: "हिन्दी" },
    { id: "lang:kn", title: "ಕನ್ನಡ" },
    { id: "lang:ta", title: "தமிழ்" },
    { id: "lang:te", title: "తెలుగు" },
  ];
  const body = "Welcome! Please choose your language.\nनमस्ते! अपनी भाषा चुनें।\nಸ್ವಾಗತ! ನಿಮ್ಮ ಭಾಷೆ ಆರಿಸಿ.\nவரவேற்கிறோம்! உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்.\nస్వాగతం! మీ భాషను ఎంచుకోండి.";
  log(phone, "out", "buttons", body, rows);
  if (!whatsappLive()) return;
  await post({
    to: phone,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: { button: "Language / भाषा", sections: [{ title: "Language", rows }] },
    },
  });
}

/** True when a Razorpay payment configuration (Meta Business Suite) is set, so the in-chat payment card can be used. */
export const nativePaymentsOn = () => !!process.env.WHATSAPP_PAYMENT_CONFIG;

/**
 * Native order card with a Pay button: the customer pays by UPI or card inside WhatsApp, through Razorpay.
 * Amounts are INR in paise, and Meta requires total = subtotal + tax. Returns false if Meta rejects the card,
 * so the caller can fall back to a payment link.
 */
export async function sendPaymentCard(
  phone: string,
  order: { id: number; gst: number },
  lines: { item_id: number | null; name: string; unit_price: number; qty_confirmed: number }[],
  body: string,
  footer: string,
) {
  const paise = (n: number) => Math.round(n * 100);
  const items = lines.map((l) => ({
    retailer_id: String(l.item_id ?? l.name),
    name: l.name.slice(0, 60),
    amount: { value: paise(l.unit_price), offset: 100 },
    quantity: l.qty_confirmed,
  }));
  const subtotal = items.reduce((s, i) => s + i.amount.value * i.quantity, 0);
  const tax = paise(order.gst);
  const parameters = {
    reference_id: `ord${order.id}-${Date.now().toString(36)}`, // unique per card; the order id is read back from it
    type: "physical-goods",
    payment_settings: [
      {
        type: "payment_gateway",
        payment_gateway: {
          type: "razorpay",
          configuration_name: process.env.WHATSAPP_PAYMENT_CONFIG,
          razorpay: { receipt: `INV-${order.id}`, notes: { order_id: String(order.id) } },
        },
      },
    ],
    currency: "INR",
    total_amount: { value: subtotal + tax, offset: 100 },
    order: {
      status: "pending",
      ...(process.env.WHATSAPP_CATALOG_ID ? { catalog_id: process.env.WHATSAPP_CATALOG_ID } : {}),
      items,
      subtotal: { value: subtotal, offset: 100 },
      tax: { value: tax, offset: 100, description: "GST 5%" },
    },
  };
  log(phone, "out", "text", `${body}\n💳 ₹${((subtotal + tax) / 100).toFixed(2)}`);
  if (!whatsappLive()) return true;
  // Meta's docs show `parameters` both as an object and as a JSON string, so try the object first, then the string.
  for (const p of [parameters, JSON.stringify(parameters)]) {
    const ok = await post({
      to: phone,
      type: "interactive",
      interactive: {
        type: "order_details",
        body: { text: body.slice(0, 1024) },
        footer: { text: footer.slice(0, 60) },
        action: { name: "review_and_pay", parameters: p },
      },
    });
    if (ok) return true;
  }
  return false;
}

/** Sends a PDF. The file is served from our own invoice route so Meta can fetch it. */
export async function sendDocument(phone: string, docUrl: string, filename: string, caption: string) {
  log(phone, "out", "document", caption, undefined, docUrl);
  if (!whatsappLive()) return;
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return console.error("PUBLIC_BASE_URL is not set, so Meta cannot fetch the invoice PDF.");
  await post({ to: phone, type: "document", document: { link: base + docUrl, filename, caption } });
}

/** Downloads a voice note, photo or file the customer sent. */
export async function downloadMedia(mediaId: string): Promise<Media> {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  // Step 1: the media id only resolves to a short-lived URL
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: auth });
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number; error?: { message: string } };
  console.log("media lookup", metaRes.status, { mime: meta.mime_type, size: meta.file_size, error: meta.error?.message });
  if (!metaRes.ok || !meta.url || !meta.mime_type) throw new Error(`media lookup failed: ${meta.error?.message ?? metaRes.status}`);
  // Step 2: download the bytes
  const file = await fetch(meta.url, { headers: auth });
  if (!file.ok) throw new Error(`media download failed: ${file.status}`);
  const data = Buffer.from(await file.arrayBuffer());
  const mime = meta.mime_type.split(";")[0];
  // Keep a copy (data/ is gitignored) so a bad transcription can be replayed by hand
  const dir = path.join(process.cwd(), "data", "media");
  mkdirSync(dir, { recursive: true });
  const saved = path.join(dir, `${mediaId}.${mime.split("/")[1] ?? "bin"}`);
  writeFileSync(saved, data);
  console.log("media downloaded", { mime, bytes: data.length, saved });
  return { mime, data };
}
