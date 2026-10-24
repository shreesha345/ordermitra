"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./lang";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from "./ui";

const LABELS = {
  return: { approve: "Approve return", reject: "Reject" },
  licence: { approve: "Verify licence", reject: "Reject" },
  callback: { approve: "Mark called", reject: null },
} as const;

export function RequestActions({ id, kind }: { id: number; kind: keyof typeof LABELS }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function run(action: "approve" | "reject") {
    setBusy(true);
    await fetch(`/api/requests/${id}`, { method: "POST", body: JSON.stringify({ action }), headers: { "Content-Type": "application/json" } });
    setBusy(false);
    router.refresh();
  }

  const l = LABELS[kind];
  return (
    <div className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => run("approve")} className={kind === "callback" ? BTN_SECONDARY : BTN_PRIMARY}>{t(l.approve)}</button>
      {l.reject && <button disabled={busy} onClick={() => run("reject")} className={BTN_DANGER}>{t(l.reject)}</button>}
    </div>
  );
}
