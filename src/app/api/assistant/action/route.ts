import type { NextRequest } from "next/server";
import { applyAction, cancelAction, undoAction } from "@/lib/owner-assistant";

// The owner's own buttons on a change the assistant proposed: Confirm, Cancel, or Undo. Never called by the model.
export async function POST(req: NextRequest) {
  const { id, op } = (await req.json().catch(() => ({}))) as { id?: string; op?: string };
  if (typeof id !== "string" || !/^[\w-]{6,40}$/.test(id)) return Response.json({ error: "Unknown change" }, { status: 400 });
  try {
    const action = op === "confirm" ? applyAction(id) : op === "cancel" ? cancelAction(id) : op === "undo" ? undoAction(id) : null;
    if (!action) return Response.json({ error: "Unknown request" }, { status: 400 });
    return Response.json({ action });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not do that" }, { status: 409 });
  }
}
