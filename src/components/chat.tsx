import { Fragment } from "react";
import { FileText } from "lucide-react";
import type { Message } from "@/lib/db";

/** WhatsApp's *bold* markup -> <strong>. */
function rich(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    /^\*[^*\n]+\*$/.test(part) ? <strong key={i}>{part.slice(1, -1)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** A WhatsApp-style thread. Pass onButton to make reply buttons tappable (simulator); without it they are shown read-only. */
export function ChatThread({ messages, onButton, disabled }: { messages: Message[]; onButton?: (id: string, title: string) => void; disabled?: boolean }) {
  return (
    <ol className="flex flex-col gap-2">
      {messages.map((m) => {
        const out = m.direction === "out";
        const buttons = m.buttons ? (JSON.parse(m.buttons) as { id: string; title: string }[]) : [];
        return (
          <li key={m.id} className={`flex flex-col ${out ? "items-start" : "items-end"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${out ? "rounded-tl-none bg-surface" : "rounded-tr-none bg-wa-out"}`}>
              {m.kind === "document" ? (
                <a href={m.doc_url ?? "#"} target="_blank" className="flex items-center gap-2 rounded-md bg-subtle p-2 font-medium hover:bg-line">
                  <FileText className="size-5 text-danger" aria-hidden />
                  {m.body}.pdf
                </a>
              ) : (
                <div className="break-words whitespace-pre-wrap">{rich(m.body)}</div>
              )}
              <div className="mt-0.5 text-right text-[10px] text-faint">{time(m.at)}</div>
            </div>
            {buttons.length > 0 && (
              <div className="mt-1 flex w-full max-w-[85%] flex-col gap-1">
                {buttons.map((b) =>
                  onButton ? (
                    <button
                      key={b.id}
                      disabled={disabled}
                      onClick={() => onButton(b.id, b.title)}
                      className="rounded-lg bg-surface px-3 py-2 text-sm font-medium text-wa-dark shadow-sm hover:bg-wa-soft disabled:opacity-50"
                    >
                      {b.title}
                    </button>
                  ) : (
                    <span key={b.id} className="rounded-lg bg-surface/70 px-3 py-1.5 text-center text-sm text-wa-dark">{b.title}</span>
                  ),
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
