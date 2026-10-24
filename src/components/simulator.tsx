"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Mic, Paperclip, Plus, SendHorizontal, Sparkles, Square } from "lucide-react";
import type { AgentRun, Message } from "@/lib/db";
import { AgentTrace } from "./agent-trace";
import { ChatThread } from "./chat";
import { useT } from "./lang";
import { BTN_SECONDARY, INPUT, StatusPill } from "./ui";

type Retailer = { phone: string; name: string; city: string; language: string };
type Reply = { messages: Message[]; order: { id: number; status: string } | null; runs?: AgentRun[]; error?: string };
type Sample = { label: string; text: string };

const SIM_PREFIX = "910000"; // same as SIM_PREFIX in lib/whatsapp.ts, which is server-only

export function Simulator({ retailers: initial, samples, asks, ai }: { retailers: Retailer[]; samples: Sample[]; asks: Sample[]; ai: boolean }) {
  const t = useT();
  const [retailers, setRetailers] = useState(initial);
  const [phone, setPhone] = useState(initial[0]?.phone ?? "");
  const [reply, setReply] = useState<Reply>({ messages: [], order: null });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const current = retailers.find((r) => r.phone === phone);

  useEffect(() => {
    if (!phone) return;
    let live = true;
    fetch(`/api/simulator?phone=${phone}`)
      .then((r) => r.json() as Promise<Reply>)
      .then((r) => live && setReply(r));
    return () => {
      live = false;
    };
  }, [phone]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [reply.messages.length, busy]);

  async function send(fields: Record<string, string | Blob>) {
    if (!current) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("phone", current.phone);
    form.set("name", current.name);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const res = await fetch("/api/simulator", { method: "POST", body: form });
    const data = (await res.json()) as Reply;
    setBusy(false);
    if (!res.ok) return setError(data.error ?? t("Something went wrong"));
    setReply(data);
  }

  function addRetailer(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const r = { phone: SIM_PREFIX + String(Math.floor(200000 + Math.random() * 799999)), name: newName.trim(), city: "", language: "en" };
    setRetailers((rs) => [...rs, r]);
    setPhone(r.phone);
    setNewName("");
  }

  async function toggleMic() {
    if (rec) return rec.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        send({ file: new File(chunks, "voice-note.webm", { type: r.mimeType.split(";")[0] || "audio/webm" }) });
      };
      r.start();
      setRec(r);
    } catch {
      setError(t("Microphone is not available in this browser."));
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[260px_minmax(0,440px)_1fr]">
      <section aria-label={t("Retailers")} className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{t("Send as")}</h2>
        {retailers.map((r) => (
          <button
            key={r.phone}
            onClick={() => setPhone(r.phone)}
            aria-pressed={r.phone === phone}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${r.phone === phone ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-subtle"}`}
          >
            <div className="font-medium">{r.name}</div>
            <div className="text-xs text-muted">{r.city || `+${r.phone}`}</div>
          </button>
        ))}
        <form onSubmit={addRetailer} className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("New pharmacy name")} aria-label={t("New pharmacy name")} className={INPUT} />
          <button className={BTN_SECONDARY} aria-label={t("Add pharmacy")}><Plus className="size-4" /></button>
        </form>
        <p className="text-xs text-muted">{t("A new pharmacy is greeted with the language picker first, just like on WhatsApp.")}</p>
      </section>

      <section aria-label={t("Chat")} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex items-center gap-3 bg-wa-dark px-4 py-3 text-white">
          <div className="grid size-9 place-items-center rounded-full bg-white/20 text-sm font-semibold" aria-hidden>{current?.name[0] ?? "?"}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{current?.name ?? t("Pick a retailer")}</div>
            <div className="text-xs text-white/70">{busy ? t("Assistant is typing…") : t("Chatting with your order desk")}</div>
          </div>
        </div>
        <div className="h-[520px] overflow-y-auto bg-wa-chat p-3" aria-live="polite">
          {reply.messages.length ? (
            <ChatThread messages={reply.messages} onButton={(id, title) => send({ buttonId: id, text: title })} disabled={busy} />
          ) : (
            <p className="mt-40 text-center text-sm text-muted">{t("Send an order or ask a question to start.")}</p>
          )}
          {busy && <div className="mt-2 w-fit rounded-lg bg-surface px-3 py-2 text-sm text-muted shadow-sm">…</div>}
          <div ref={end} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send({ text }).then(() => setText(""));
          }}
          className="flex items-center gap-1.5 border-t border-line p-2"
        >
          <input ref={file} type="file" hidden accept="audio/*,image/*,application/pdf,.xlsx,.xlsm,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) send({ file: f }); e.target.value = ""; }} />
          <button type="button" onClick={() => file.current?.click()} disabled={busy || !current} className="rounded-full p-2 text-muted hover:bg-subtle disabled:opacity-50" aria-label={t("Attach a voice note, photo, PDF or Excel sheet")}>
            <Paperclip className="size-5" />
          </button>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Type an order or a question")} aria-label={t("Message")} className={`${INPUT} rounded-full`} disabled={busy || !current} />
          {text.trim() ? (
            <button disabled={busy} className="grid size-10 shrink-0 place-items-center rounded-full bg-wa-dark text-white disabled:opacity-50" aria-label={t("Send")}>
              <SendHorizontal className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={toggleMic} disabled={busy || !current} className={`grid size-10 shrink-0 place-items-center rounded-full text-white disabled:opacity-50 ${rec ? "bg-danger" : "bg-wa-dark"}`} aria-label={rec ? t("Stop and send voice note") : t("Record a voice note")}>
              {rec ? <Square className="size-4" /> : <Mic className="size-4" />}
            </button>
          )}
        </form>
        {error && <p role="alert" className="border-t border-line px-4 py-2 text-sm text-danger">{error}</p>}
      </section>

      <section aria-label={t("Help")} className="flex flex-col gap-4">
        {reply.order && (
          <Link href={`/orders/${reply.order.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-subtle">
            <div>
              <div className="text-sm font-medium">Order #{reply.order.id} in your dashboard</div>
              <div className="mt-1"><StatusPill status={reply.order.status} /></div>
            </div>
            <ArrowRight className="size-4 text-muted" aria-hidden />
          </Link>
        )}
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-primary" aria-hidden /> What the AI agent did
          </h2>
          {reply.runs?.length ? (
            <div className="flex flex-col gap-5 pl-5">
              {reply.runs.slice(0, 3).map((r, i) => <AgentTrace key={r.id} run={r} compact={i > 0} t={t} />)}
            </div>
          ) : (
            <p className="text-sm text-muted">{t("Each step shows up here as the assistant works: reading the message, finding the items, checking stock and credit, making the bill.")}</p>
          )}
        </div>
        {asks.length > 0 && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2 text-sm font-medium">{t("Try something harder")}</h2>
            <div className="flex flex-col gap-2">
              {asks.map((s) => (
                <button key={s.label} onClick={() => setText(s.text)} disabled={!current} className="rounded-lg bg-subtle px-3 py-2 text-left text-sm hover:bg-line disabled:opacity-50">
                  <div className="text-xs text-muted">{s.label}</div>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {samples.length > 0 && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2 text-sm font-medium">{t("Try a sample order")}</h2>
            <div className="flex flex-col gap-2">
              {samples.map((s) => (
                <button key={s.label} onClick={() => setText(s.text)} disabled={!current} className="rounded-lg bg-subtle px-3 py-2 text-left text-sm hover:bg-line disabled:opacity-50">
                  <div className="text-xs text-muted">{s.label}</div>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
          <h2 className="mb-2 font-medium text-ink">{t("What the assistant can do")}</h2>
          <ul className="list-disc space-y-1 pl-4">
            <li>{t("Take orders from text, voice notes, photos of lists (handwritten too), PDFs and Excel sheets, in any language, with units like strips, boxes or tablets.")}</li>
            <li>{t("Answer stock and rate questions, and offer a same-composition substitute when something is out.")}</li>
            <li>{t("Check credit and licence before billing: approve on credit, ask for payment first, or hold for you.")}</li>
            <li>{t("Send a GST invoice with a pay-now discount; the sooner they pay, the less they pay.")}</li>
            <li>{t("Tell retailers their dues and order status, repeat their last order, and take returns, licence photos and GSTINs.")}</li>
          </ul>
          {!ai && <p className="mt-3 rounded-lg bg-warn-soft p-2 text-warn">{t("The AI assistant is off, so only simple typed orders work. Voice notes and photos need it.")}</p>}
        </div>
      </section>
    </div>
  );
}
