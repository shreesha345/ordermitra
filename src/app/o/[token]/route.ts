import { connection, type NextRequest } from "next/server";
import { orderPage } from "@/lib/order-page";

export async function GET(_req: NextRequest, ctx: RouteContext<"/o/[token]">) {
  await connection();
  const { token } = await ctx.params;
  return orderPage(token);
}
