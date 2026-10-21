"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrderActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: "mark_paid" | "cancel") {
    setBusy(true);
    await fetch(`/api/orders/${id}`, { method: "POST", body: JSON.stringify({ action }), headers: { "Content-Type": "application/json" } });
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      {status === "awaiting_payment" && (
        <button disabled={busy} onClick={() => run("mark_paid")} className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Mark UPI payment received
        </button>
      )}
      {!["paid", "confirmed_cod", "cancelled"].includes(status) && (
        <button disabled={busy} onClick={() => run("cancel")} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-danger disabled:opacity-50">
          Cancel order
        </button>
      )}
    </>
  );
}
