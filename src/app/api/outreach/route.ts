import type { NextRequest } from "next/server";
import { remind, type Kind } from "@/lib/outreach";

/** { kind: "dues" | "reorder", phones?: [...] }. Without phones: every retailer it applies to. */
export async function POST(req: NextRequest) {
  const { kind, phones } = (await req.json()) as { kind?: Kind; phones?: string[] };
  if (kind !== "dues" && kind !== "reorder") return Response.json({ error: "Unknown kind" }, { status: 400 });
  return Response.json({ sent: await remind(kind, Array.isArray(phones) ? phones.map(String) : undefined) });
}
