"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./lang";
import { BTN_PRIMARY, INPUT } from "./ui";

type Values = { city: string; drug_licence: string; licence_forms: string; licence_expiry: string; verified: boolean; gstin: string; credit_limit: number };

export function RetailerForm({ phone, initial }: { phone: string; initial: Values }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(form: FormData) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/customers/${phone}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(form), verified: form.get("verified") === "on", credit_limit: Number(form.get("credit_limit")) }),
    });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: t("Saved") } : { ok: false, text: ((await res.json()) as { error?: string }).error ?? t("Could not save") });
    if (res.ok) router.refresh();
  }

  const field = (name: Exclude<keyof Values, "verified">, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted">{t(label)}</span>
      <input name={name} defaultValue={initial[name]} className={INPUT} {...props} />
    </label>
  );

  return (
    <form action={save} className="flex flex-col gap-3 px-5 pb-5">
      {field("drug_licence", "Drug licence no.", { placeholder: "KA-DK-20/21-0000" })}
      <div className="grid grid-cols-2 gap-3">
        {field("licence_forms", "Forms", { placeholder: "20, 21" })}
        {field("licence_expiry", "Valid until", { type: "date" })}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="verified" defaultChecked={initial.verified} className="size-4 accent-[var(--primary)]" />
        {t("I have checked this licence (allows Schedule H orders)")}
      </label>
      {field("gstin", "GSTIN", { placeholder: "29ABCDE1234F1ZW", maxLength: 15 })}
      {field("city", "Area / city")}
      {field("credit_limit", "Credit limit (₹)", { type: "number", min: 0, step: 1000, inputMode: "numeric" })}
      <div className="flex items-center gap-3">
        <button disabled={busy} className={BTN_PRIMARY}>{busy ? t("Saving…") : t("Save")}</button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
