import type { NextRequest } from "next/server";
import { askOwner, type ChatTurn } from "@/lib/owner-assistant";
import { uiLang } from "@/lib/ui-lang-server";

// The dashboard assistant. Takes the conversation so far, and optionally a photo or PDF (e.g. a supplier bill).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const history = JSON.parse(String(form.get("messages") ?? "[]")) as ChatTurn[];
    if (!history.length || history.at(-1)?.role !== "user") return Response.json({ error: "No question" }, { status: 400 });
    const f = form.get("file");
    const file = f instanceof File && f.size ? { mime: f.type.split(";")[0] || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()), name: f.name } : undefined;
    if (file && !/^image\/|application\/pdf/.test(file.mime)) return Response.json({ error: "Send a photo or a PDF. For Excel sheets, use Upload on the Stock page." }, { status: 415 });
    return Response.json(await askOwner(history, await uiLang(), file));
  } catch (e) {
    console.error("dashboard assistant failed", e);
    return Response.json({ error: "The assistant could not answer. Please try again." }, { status: 500 });
  }
}
