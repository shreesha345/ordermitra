import type { NextRequest } from "next/server";
import { db, type AgentRun, type Message } from "@/lib/db";
import { handleIncoming } from "@/lib/assistant";
import { SIM_PREFIX } from "@/lib/whatsapp";

// The dashboard's WhatsApp simulator: messages go through the same order flow as real WhatsApp,
// but only for simulated numbers, and replies are read back from the message log instead of being sent.

const simPhone = (p: string | null) => (p && p.startsWith(SIM_PREFIX) && /^\d{12}$/.test(p) ? p : null);

function chat(phone: string) {
  const messages = (db().prepare("SELECT * FROM messages WHERE phone = ? ORDER BY id DESC LIMIT 80").all(phone) as Message[]).reverse();
  const order = db().prepare("SELECT id, status FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 1").get(phone) as { id: number; status: string } | undefined;
  // What the AI agent did for the last few messages, newest first, for the side panel.
  const runs = db().prepare("SELECT * FROM agent_runs WHERE phone = ? ORDER BY id DESC LIMIT 4").all(phone) as AgentRun[];
  return { messages, order: order ? { ...order } : null, runs: runs.map((r) => ({ ...r })) };
}

export async function GET(req: NextRequest) {
  const phone = simPhone(req.nextUrl.searchParams.get("phone"));
  if (!phone) return Response.json({ error: "Not a simulator number" }, { status: 400 });
  return Response.json(chat(phone));
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const phone = simPhone(form.get("phone") as string | null);
  if (!phone) return Response.json({ error: "Not a simulator number" }, { status: 400 });
  const name = (form.get("name") as string | null) || undefined;
  const text = ((form.get("text") as string | null) ?? "").trim();
  const buttonId = (form.get("buttonId") as string | null) || undefined;
  const file = form.get("file");

  if (buttonId) {
    await handleIncoming({ phone, name, kind: "button", buttonId, text: text || buttonId });
  } else if (file instanceof File && file.size) {
    if (file.size > 4 * 1024 * 1024) return Response.json({ error: "Files up to 4 MB" }, { status: 413 });
    const mime = (file.type || "application/octet-stream").split(";")[0];
    const kind = mime.startsWith("audio/") ? "audio" : mime.startsWith("image/") ? "image" : "document";
    await handleIncoming({ phone, name, kind, text: text || undefined, media: { mime, data: Buffer.from(await file.arrayBuffer()), name: file.name } });
  } else if (text) {
    await handleIncoming({ phone, name, kind: "text", text });
  } else {
    return Response.json({ error: "Empty message" }, { status: 400 });
  }
  return Response.json(chat(phone));
}
