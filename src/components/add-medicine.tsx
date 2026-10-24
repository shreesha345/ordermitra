"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { UNITS } from "@/lib/units";
import { useT } from "./lang";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT } from "./ui";

export type Known = { name: string; unit: string; price: number; gst_rate: number; mfr: string; salt: string; free: number; schedule: string };

const LABEL = "flex flex-col gap-1 text-sm font-medium";
const blank = { name: "", qty: "", unit: "strip", price: "", mrp: "", gst: "5", mfr: "", salt: "", batch: "", expiry: "", licence: false, hsn: "", rack: "", box: "" };

/** "Add medicine": a new medicine, or more stock of one you have. The quantity is added to what is there. */
export function AddMedicine({ known }: { known: Known[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const have = known.find((k) => k.name.toLowerCase() === f.name.trim().toLowerCase());
  const set = (k: keyof typeof blank, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  function pickName(name: string) {
    const k = known.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    setF((x) => (k ? { ...x, name, unit: k.unit, price: String(k.price), gst: String(k.gst_rate), mfr: k.mfr, salt: k.salt, licence: !!k.schedule } : { ...x, name }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const n = (s: string) => (s.trim() === "" ? undefined : Number(s));
    // A month picker gives YYYY-MM; medicines expire at the end of the printed month
    const expiry = f.expiry ? new Date(Number(f.expiry.slice(0, 4)), Number(f.expiry.slice(5, 7)), 0).toLocaleDateString("en-CA") : undefined;
    const res = await fetch("/api/inventory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(), stock: n(f.qty), unit: f.unit, price: n(f.price), mrp: n(f.mrp), gst_rate: n(f.gst), mfr: f.mfr.trim() || undefined,
        salt: f.salt.trim() || undefined, batch: f.batch.trim() || undefined, expiry, schedule: f.licence ? "H" : have?.schedule ? "" : undefined,
        hsn: f.hsn.trim() || undefined, rack: f.rack.trim() || undefined, box_qty: n(f.box),
      }),
    });
    setBusy(false);
    const data = (await res.json()) as { error?: string; added?: number };
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? t("Could not save") });
    setMsg({ ok: true, text: data.added ? t("{name} added.", { name: f.name.trim() }) : t("{name} updated.", { name: f.name.trim() }) });
    setF(blank);
    router.refresh();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setMsg(null); }} className={BTN_PRIMARY}>
        <Plus className="size-4" aria-hidden /> {t("Add medicine")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form onSubmit={save} role="dialog" aria-label={t("Add medicine")} className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="font-semibold">{t("Add medicine")}</h2>
                <p className="text-xs text-muted">{t("A new medicine, or more stock of one you already have.")}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t("Close")}><X className="size-4" /></button>
            </header>
            <div className="grid grid-cols-2 gap-4 overflow-y-auto px-5 py-4">
              <label className={`${LABEL} col-span-2`}>
                {t("Medicine name")} *
                <input required list="known-medicines" value={f.name} onChange={(e) => pickName(e.target.value)} placeholder={t("e.g. Dolo 650 (15 tabs)")} className={INPUT} />
                <datalist id="known-medicines">{known.map((k) => <option key={k.name} value={k.name} />)}</datalist>
                {have && <span className="text-xs font-normal text-primary">{t("Already in stock: {n} {unit}. The quantity below is added to it.", { n: have.free, unit: have.unit })}</span>}
              </label>
              <label className={LABEL}>
                {t("Quantity received")}
                <input type="number" inputMode="numeric" value={f.qty} onChange={(e) => set("qty", e.target.value)} placeholder="0" className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("Sold as")}
                <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className={INPUT}>
                  {[...new Set([f.unit, ...UNITS])].map((u) => <option key={u} value={u}>{t(u)}</option>)}
                </select>
              </label>
              <label className={LABEL}>
                {t("Your price (₹, before GST)")}{!have && " *"}
                <input type="number" step="0.01" inputMode="decimal" required={!have} value={f.price} onChange={(e) => set("price", e.target.value)} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("MRP (₹)")}
                <input type="number" step="0.01" inputMode="decimal" value={f.mrp} onChange={(e) => set("mrp", e.target.value)} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("Company")}
                <input value={f.mfr} onChange={(e) => set("mfr", e.target.value)} placeholder={t("e.g. Micro Labs")} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("GST")}
                <select value={f.gst} onChange={(e) => set("gst", e.target.value)} className={INPUT}>
                  {["0", "5", "12", "18"].map((g) => <option key={g} value={g}>{g}%</option>)}
                </select>
              </label>
              <label className={`${LABEL} col-span-2`}>
                {t("Contents")}
                <input value={f.salt} onChange={(e) => set("salt", e.target.value)} placeholder={t("e.g. Paracetamol 650mg")} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("Batch number")}
                <input value={f.batch} onChange={(e) => set("batch", e.target.value)} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("Expiry month")}
                <input type="month" value={f.expiry} onChange={(e) => set("expiry", e.target.value)} className={INPUT} />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.licence} onChange={(e) => set("licence", e.target.checked)} className="size-4 accent-primary" />
                {t("Needs the retailer's drug licence (Schedule H, H1 or X)")}
              </label>
              <details className="col-span-2 text-sm">
                <summary className="cursor-pointer text-muted hover:text-ink">{t("More details")}</summary>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label className={LABEL}>HSN<input value={f.hsn} onChange={(e) => set("hsn", e.target.value)} placeholder="3004" className={INPUT} /></label>
                  <label className={LABEL}>{t("Rack")}<input value={f.rack} onChange={(e) => set("rack", e.target.value)} className={INPUT} /></label>
                  <label className={LABEL}>{t("Units in a box")}<input type="number" value={f.box} onChange={(e) => set("box", e.target.value)} className={INPUT} /></label>
                </div>
              </details>
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
              {msg && <span role="status" className={`mr-auto text-sm font-medium ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
              <button type="button" onClick={() => setOpen(false)} className={BTN_SECONDARY}>{t("Done")}</button>
              <button disabled={busy || !f.name.trim()} className={BTN_PRIMARY}>{busy ? t("Saving…") : t("Save")}</button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
