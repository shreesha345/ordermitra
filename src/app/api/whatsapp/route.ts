import { after, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleIncoming, handlePayment } from "@/lib/orders";
import { downloadMedia } from "@/lib/whatsapp";

type WaMessage = {
  id: string;
  from: string;
  type: "text" | "audio" | "image" | "document" | "interactive" | "button";
  text?: { body: string };
  audio?: { id: string };
  image?: { id: string };
  document?: { id: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
};
type WaStatus = {
  type?: string;
  status?: string;
  payment?: {
    reference_id: string;
    amount?: { value: number; offset: number };
    transaction?: { id?: string; pg_transaction_id?: string; status?: string };
  };
};
type Payload = {
  entry?: { changes?: { value?: { statuses?: WaStatus[]; messages?: WaMessage[]; contacts?: { wa_id: string; profile?: { name?: string } }[] } }[] }[];
};

// Meta retries a webhook until it gets a 200, so remember what was already handled.
const seen = new Set<string>();

/** Meta calls this once when you register the webhook. */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not configured: accept (fine locally, set it in production)
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  const body = JSON.parse(raw) as Payload;

  // Reply 200 straight away; transcription and replies run after the response.
  after(async () => {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
        // Result of a payment made on the in-chat payment card
        for (const s of change.value?.statuses ?? []) {
          if (s.type !== "payment" || s.status !== "captured" || !s.payment) continue;
          const key = `pay:${s.payment.reference_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            await handlePayment(s.payment);
          } catch (e) {
            console.error("payment status failed", s.payment.reference_id, e);
          }
        }
        for (const m of change.value?.messages ?? []) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          try {
            const mediaId = m.audio?.id ?? m.image?.id ?? m.document?.id;
            const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
            await handleIncoming({
              phone: m.from,
              name: names.get(m.from),
              kind: reply ? "button" : m.type === "interactive" || m.type === "button" ? "text" : (m.type as "text"),
              text: reply?.title ?? m.text?.body,
              buttonId: reply?.id,
              media: mediaId ? () => downloadMedia(mediaId) : undefined,
            });
          } catch (e) {
            console.error("webhook message failed", m.id, e);
          }
        }
      }
    }
  });
  return new Response("ok", { status: 200 });
}
