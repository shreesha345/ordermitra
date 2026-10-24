"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, CheckCircle2, CreditCard, Truck, Wallet, XCircle } from "lucide-react";
import { useT } from "./lang";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from "./ui";

type Action = "mark_paid" | "cancel" | "dispatch" | "approve_credit" | "approve_pay_first" | "deny";

export function OrderActions({ id, status, dispatched, payNow }: { id: number; status: string; dispatched: boolean; payNow: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: Action) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${id}`, { method: "POST", body: JSON.stringify({ action }), headers: { "Content-Type": "application/json" } });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !data.ok) setError(data.error ?? t("That action is not possible for this order any more"));
    router.refresh();
  }

  return (
    <>
      {status === "awaiting_review" && (
        <>
          <button disabled={busy} onClick={() => run("approve_credit")} className={BTN_PRIMARY}>
            <CheckCircle2 className="size-4" aria-hidden /> {t("OK, give on credit")}
          </button>
          <button disabled={busy} onClick={() => run("approve_pay_first")} className={BTN_SECONDARY}>
            <CreditCard className="size-4" aria-hidden /> {t("OK, but pay first")}
          </button>
          <button disabled={busy} onClick={() => run("deny")} className={BTN_DANGER}>
            <Ban className="size-4" aria-hidden /> {t("Say no")}
          </button>
        </>
      )}
      {["awaiting_payment", "confirmed_cod"].includes(status) && (
        <button disabled={busy} onClick={() => run("mark_paid")} className={BTN_PRIMARY} title={t("Includes today's early-payment discount")}>
          <Wallet className="size-4" aria-hidden /> {t("Mark as paid ({amount})", { amount: payNow })}
        </button>
      )}
      {["paid", "confirmed_cod"].includes(status) && !dispatched && (
        <button disabled={busy} onClick={() => run("dispatch")} className={BTN_SECONDARY}>
          <Truck className="size-4" aria-hidden /> {t("Mark as sent out")}
        </button>
      )}
      {!["paid", "confirmed_cod", "cancelled", "awaiting_review"].includes(status) && (
        <button disabled={busy} onClick={() => run("cancel")} className={BTN_DANGER}>
          <XCircle className="size-4" aria-hidden /> {t("Cancel order")}
        </button>
      )}
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </>
  );
}
