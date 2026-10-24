import type { NextRequest } from "next/server";
import { closeRequest } from "@/lib/requests";

/** approve (a return, or verify a licence), reject, or done (a callback). The retailer is told on WhatsApp. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/requests/[id]">) {
  const { id } = await ctx.params;
  const { action } = (await req.json()) as { action?: string };
  if (action !== "approve" && action !== "reject" && action !== "done") return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json({ ok: await closeRequest(Number(id), action) });
}
