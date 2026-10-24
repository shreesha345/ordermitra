import { demoAllowed, loadDemo } from "@/lib/demo";

/** Replaces all data with the demo set. Only when DEMO_MODE=1, or while there are no orders yet. */
export async function POST() {
  if (!demoAllowed()) return Response.json({ error: "Demo data can only be loaded into an empty store, or with DEMO_MODE=1." }, { status: 403 });
  loadDemo();
  return Response.json({ ok: true });
}
