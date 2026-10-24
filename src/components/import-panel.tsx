"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useT } from "./lang";
import { BTN_PRIMARY } from "./ui";


export function ImportPanel() {
  const router = useRouter();
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/inventory/import", { method: "POST", body: form });
    const data = (await res.json()) as {
      added?: number; updated?: number; batches?: number; skipped?: number; error?: string;
      via?: "sheet" | "ai"; sheet?: string; headerRow?: number; columns?: Record<string, string>;
    };
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? t("Could not read that file") });
    const parts = [
      t("{n} new medicines", { n: data.added ?? 0 }),
      t("{n} updated", { n: data.updated ?? 0 }),
      data.batches ? t("{n} expiry dates", { n: data.batches }) : "",
    ].filter(Boolean);
    setMsg({ ok: true, text: `${t("Stock list updated")}: ${parts.join(", ")}.` });
    router.refresh();
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
      className={`mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed p-5 transition-colors ${over ? "border-primary bg-primary-soft" : "border-line bg-surface"}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Upload className="size-4" aria-hidden />
        </span>
        <div>
          <div className="text-sm font-medium">{t("Update your stock list")}</div>
          <div className="text-sm text-muted">{t("Drop an Excel sheet, a photo of your list, or a supplier bill here. Quantities, prices and expiry dates are picked up for you.")}</div>
          {msg && <div role="status" className={`mt-2 text-sm font-medium ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</div>}
        </div>
      </div>
      <input ref={input} type="file" hidden accept=".xlsx,.xlsm,.csv,.tsv,image/*,application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button disabled={busy} onClick={() => input.current?.click()} className={BTN_PRIMARY}>
        {busy ? t("Reading…") : t("Choose file")}
      </button>
    </div>
  );
}
