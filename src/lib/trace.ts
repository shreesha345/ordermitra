import { AsyncLocalStorage } from "node:async_hooks";
import { db, type Step } from "./db";

// What the assistant did for one incoming message: which file it read, what it understood, which checks it ran.
// Any code in the order flow can add a step; it is saved with the run and shown in the simulator and on the order.

type Run = { phone: string; input: string; steps: Step[]; provider: string; orderId: number | null; reply: string[]; started: number };

const store = new AsyncLocalStorage<Run>();

export function step(kind: string, label: string, detail?: string, tone?: Step["tone"]) {
  store.getStore()?.steps.push({ kind, label, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) });
}

/** Links the run to the order it created or moved along. */
export function traceOrder(orderId: number) {
  const r = store.getStore();
  if (r && !r.orderId) r.orderId = orderId;
}

export function traceProvider(name: string) {
  const r = store.getStore();
  if (r) r.provider = name;
}

export function traceReply(text: string) {
  store.getStore()?.reply.push(text);
}

/** Runs fn with a fresh trace and saves it, if anything was recorded. */
export async function withTrace<T>(phone: string, input: string, fn: () => Promise<T>): Promise<T> {
  const run: Run = { phone, input, steps: [], provider: "", orderId: null, reply: [], started: Date.now() };
  try {
    return await store.run(run, fn);
  } finally {
    if (run.steps.length) {
      db()
        .prepare("INSERT INTO agent_runs (phone, input, steps, reply, provider, ms, order_id, at) VALUES (?,?,?,?,?,?,?,?)")
        .run(phone, input, JSON.stringify(run.steps), run.reply.join("\n\n"), run.provider, Date.now() - run.started, run.orderId, run.started);
    }
  }
}
