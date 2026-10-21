"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function ImportPanel() {
  const router = useRouter();
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
    const data = (await res.json()) as { added?: number; updated?: number; error?: string };
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: `Done: ${data.added} added, ${data.updated} updated.` } : { ok: false, text: data.error ?? "Import failed" });
    if (res.ok) router.refresh();
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
      className={`mb-6 flex items-center justify-between gap-4 rounded-xl border-2 border-dashed p-5 ${over ? "border-primary bg-primary-soft" : "border-primary/40 bg-primary-soft/60"}`}
    >
      <div>
        <div className="font-semibold">Drop your medicine list here</div>
        <div className="text-sm text-muted">
          Excel or CSV is read directly. A photo, PDF or distributor invoice is read by AI. Medicines, prices and stock are added or updated.
        </div>
        {msg && <div className={`mt-2 text-sm font-medium ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</div>}
      </div>
      <input ref={input} type="file" hidden accept=".xlsx,.csv,image/*,application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button disabled={busy} onClick={() => input.current?.click()} className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Reading…" : "Browse files"}
      </button>
    </div>
  );
}
