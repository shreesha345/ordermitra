"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Paperclip, RotateCcw, SendHorizontal, Sparkles, Undo2, X } from "lucide-react";
import { useT } from "./lang";

type Action = { id: string; status: "pending" | "applied" | "cancelled" | "undone" | "expired"; lines: string[]; reasons: string[] };
type Turn = { role: "user" | "assistant"; text: string; actions?: Action[]; file?: string; error?: boolean };

const KEY = "ask-chat";
const SUGGEST = [
  "How much did I sell this week?",
  "Who owes me the most money?",
  "Which medicines expire in the next 3 months?",
  "Add 100 strips of Dolo 650 at ₹30, MRP ₹34",
];

/** A button on the side of every page that opens a chat with the assistant about the business's own data. */
export function AskWidget({ ai }: { ai: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // Keep the conversation while moving between pages in this tab; a link to #ask opens the panel
  useEffect(() => {
    if (location.hash === "#ask") setOpen(true);
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) setTurns(JSON.parse(saved) as Turn[]);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-30)));
    } catch {}
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  async function send(question: string) {
    const q = question.trim();
    if ((!q && !file) || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: q, file: file?.name }];
    setTurns(next);
    setText("");
    setBusy(true);
    const form = new FormData();
    form.set("messages", JSON.stringify(next.filter((x) => !x.error).map(({ role, text }) => ({ role, text }))));
    if (file) form.set("file", file);
    setFile(null);
    try {
      const res = await fetch("/api/assistant", { method: "POST", body: form });
      const data = (await res.json()) as { reply?: string; actions?: Action[]; changed?: boolean; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? t("Something went wrong"));
      setTurns((x) => [...x, { role: "assistant", text: data.reply!, actions: data.actions }]);
      if (data.changed) router.refresh();
    } catch (e) {
      setTurns((x) => [...x, { role: "assistant", text: e instanceof Error ? e.message : t("Something went wrong"), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  // Confirm, Cancel or Undo on a change card: the owner's own decision, sent straight to the server
  async function act(id: string, op: "confirm" | "cancel" | "undo") {
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, op }) });
      const data = (await res.json()) as { action?: Action; error?: string };
      if (!res.ok || !data.action) throw new Error(data.error ?? t("Something went wrong"));
      const next = data.action;
      setTurns((x) => x.map((m) => (m.actions?.some((a) => a.id === id) ? { ...m, actions: m.actions.map((a) => (a.id === id ? next : a)) } : m)));
      if (next.status === "applied" || next.status === "undone") router.refresh();
    } catch (e) {
      setTurns((x) => [...x, { role: "assistant", text: e instanceof Error ? e.message : t("Something went wrong"), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(text);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 hover:bg-primary-hover md:right-6 md:bottom-6"
          aria-label={t("Ask the assistant")}
        >
          <Sparkles className="size-5" aria-hidden /> {t("Ask")}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button className="absolute inset-0 bg-black/20 sm:bg-black/10" aria-label={t("Close")} onClick={() => setOpen(false)} />
          <aside role="dialog" aria-label={t("Ask the assistant")} className="relative flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl sm:w-[420px]">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary"><Sparkles className="size-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{t("Ask the assistant")}</h2>
                <p className="truncate text-xs text-muted">{t("About your sales, stock, retailers and payments")}</p>
              </div>
              {turns.length > 0 && (
                <button onClick={() => setTurns([])} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" title={t("New chat")} aria-label={t("New chat")}>
                  <RotateCcw className="size-4" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" aria-label={t("Close")}>
                <X className="size-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {!ai && <p className="mb-3 rounded-lg bg-warn-soft p-3 text-sm text-warn">{t("The AI assistant is off, so it cannot answer yet. Ask your technical person to switch it on in Settings.")}</p>}
              {!turns.length ? (
                <div className="flex flex-col gap-3 pt-2">
                  <p className="text-sm text-muted">{t("Ask anything about your business in your own words, or tell me to add medicines to your stock. You can also send a photo of a supplier bill and I will add everything on it.")}</p>
                  <div className="flex flex-col gap-2">
                    {SUGGEST.map((s) => (
                      <button key={s} onClick={() => send(t(s))} disabled={busy || !ai} className="rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary-soft disabled:opacity-50">
                        {t(s)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ol className="flex flex-col gap-3">
                  {turns.map((m, i) => (
                    <li key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "rounded-br-sm bg-primary text-white" : m.error ? "rounded-bl-sm bg-danger-soft text-danger" : "rounded-bl-sm bg-subtle"}`}>
                        {m.file && <div className={`mb-1 flex items-center gap-1 text-xs ${m.role === "user" ? "text-white/80" : "text-muted"}`}><Paperclip className="size-3" aria-hidden />{m.file}</div>}
                        {m.text}
                      </div>
                      {m.actions?.map((a) => <ChangeCard key={a.id} a={a} busy={busy} act={act} />)}
                    </li>
                  ))}
                  {busy && (
                    <li className="flex items-center gap-2 text-sm text-muted">
                      <span className="flex gap-1" aria-hidden>
                        <span className="size-1.5 animate-bounce rounded-full bg-faint" />
                        <span className="size-1.5 animate-bounce rounded-full bg-faint [animation-delay:150ms]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-faint [animation-delay:300ms]" />
                      </span>
                      {t("Looking it up…")}
                    </li>
                  )}
                </ol>
              )}
              <div ref={end} />
            </div>

            <form onSubmit={submit} className="border-t border-line p-3">
              {file && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-subtle px-3 py-1.5 text-xs">
                  <Paperclip className="size-3.5 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <button type="button" onClick={() => setFile(null)} className="text-muted hover:text-ink" aria-label={t("Remove file")}><X className="size-3.5" /></button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input ref={picker} type="file" hidden accept="image/*,application/pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <button type="button" onClick={() => picker.current?.click()} disabled={busy || !ai} className="rounded-full p-2.5 text-muted hover:bg-subtle hover:text-ink disabled:opacity-50" title={t("Attach a photo or PDF of a bill or stock list")} aria-label={t("Attach a photo or PDF of a bill or stock list")}>
                  <Paperclip className="size-4" />
                </button>
                <textarea
                  ref={input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                  placeholder={t("Ask a question, or say what to add")}
                  aria-label={t("Message")}
                  disabled={!ai}
                  className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-sm placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button disabled={busy || !ai || (!text.trim() && !file)} className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-white hover:bg-primary-hover disabled:opacity-40" aria-label={t("Send")}>
                  <SendHorizontal className="size-4" />
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

const CARD = {
  pending: "border-warn/40 bg-warn-soft text-ink",
  applied: "border-success/30 bg-success-soft text-ink",
  cancelled: "border-line bg-subtle text-muted",
  undone: "border-line bg-subtle text-muted",
  expired: "border-line bg-subtle text-muted",
};

/** One change the assistant made or wants to make, with the owner's buttons. */
function ChangeCard({ a, busy, act }: { a: Action; busy: boolean; act: (id: string, op: "confirm" | "cancel" | "undo") => void }) {
  const t = useT();
  const title = { pending: t("Please check and confirm"), applied: t("Saved"), cancelled: t("Cancelled, nothing changed"), undone: t("Undone, put back as it was"), expired: t("Not saved: too old to confirm. Ask again.") }[a.status];
  return (
    <div className={`w-full max-w-[88%] rounded-xl border px-3 py-2 text-xs ${CARD[a.status]}`}>
      <div className={`mb-1 flex items-center gap-1 font-semibold ${a.status === "applied" ? "text-success" : a.status === "pending" ? "text-warn" : ""}`}>
        {a.status === "pending" ? <CircleAlert className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />} {title}
      </div>
      <ul className="flex flex-col gap-0.5">{a.lines.slice(0, 30).map((l, i) => <li key={i}>{l}</li>)}</ul>
      {a.lines.length > 30 && <div className="mt-0.5 text-muted">{t("and {n} more", { n: a.lines.length - 30 })}</div>}
      {a.status === "pending" && a.reasons.length > 0 && (
        <div className="mt-2 border-t border-warn/30 pt-1.5 text-muted">
          <div className="font-medium">{t("Why I am asking:")}</div>
          {a.reasons.slice(0, 6).map((r, i) => <div key={i}>• {r}</div>)}
        </div>
      )}
      {a.status === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={() => act(a.id, "confirm")} disabled={busy} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-50">{t("Confirm")}</button>
          <button onClick={() => act(a.id, "cancel")} disabled={busy} className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:bg-subtle disabled:opacity-50">{t("Cancel")}</button>
        </div>
      )}
      {a.status === "applied" && (
        <button onClick={() => act(a.id, "undo")} disabled={busy} className="mt-1.5 flex items-center gap-1 font-medium text-muted hover:text-ink disabled:opacity-50">
          <Undo2 className="size-3.5" aria-hidden /> {t("Undo")}
        </button>
      )}
    </div>
  );
}
