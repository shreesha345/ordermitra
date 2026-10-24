import { readFileSync } from "node:fs";
import path from "node:path";
import { connection, type NextRequest } from "next/server";
import { getRequest } from "@/lib/requests";

/** The photo the retailer sent with a request (their licence, or the strips they want to return). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/requests/[id]/file">) {
  await connection();
  const { id } = await ctx.params;
  const r = getRequest(Number(id));
  if (!r?.file) return new Response("No file", { status: 404 });
  const root = path.join(process.cwd(), "data");
  const file = path.resolve(root, r.file);
  if (!file.startsWith(root + path.sep)) return new Response("No file", { status: 404 });
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext] ?? "application/octet-stream";
  try {
    return new Response(readFileSync(file), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("No file", { status: 404 });
  }
}
