"use client";

import { useT } from "./lang";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellRing, ShoppingCart } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY } from "./ui";

/** Sends payment or reorder reminders through the assistant, to one retailer or everyone it applies to. */
export function OutreachButton({ kind, phone, label, primary }: { kind: "dues" | "reorder"; phone?: string; label: string; primary?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, phones: phone ? [phone] : undefined }) });
    const data = (await res.json()) as { sent?: number; error?: string };
    setBusy(false);
    setMsg(res.ok ? (data.sent ? t(data.sent === 1 ? "Sent to {n} retailer" : "Sent to {n} retailers", { n: data.sent }) : t("Nothing to send")) : (data.error ?? t("Failed")));
    router.refresh();
  }

  const Icon = kind === "dues" ? BellRing : ShoppingCart;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button onClick={send} disabled={busy} className={primary ? BTN_PRIMARY : BTN_SECONDARY}>
        <Icon className="size-4" aria-hidden /> {busy ? t("Sending…") : label}
      </button>
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
