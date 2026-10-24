import {
  AlertTriangle, BadgeCheck, Bot, Brain, FileSearch, FileText, Globe, History, type LucideIcon, Package, PhoneCall, ReceiptText,
  Repeat2, Search, ShieldCheck, ShoppingCart, Undo2, Wallet,
} from "lucide-react";
import type { AgentRun, Step } from "@/lib/db";
import type { T } from "@/lib/ui-lang";

const same: T = (s, vars) => Object.entries(vars ?? {}).reduce((x, [k, v]) => x.replaceAll(`{${k}}`, String(v)), s);

const ICON: Record<string, LucideIcon> = {
  read: FileSearch, understand: Brain, search: Search, stock: Package, substitute: Repeat2, credit: ShieldCheck, bill: ReceiptText,
  payment: Wallet, account: Wallet, web: Globe, history: History, return: Undo2, licence: BadgeCheck, handoff: PhoneCall,
  order: ShoppingCart, invoice: FileText, error: AlertTriangle,
};
const TONE = { good: "bg-success-soft text-success", warn: "bg-warn-soft text-warn", bad: "bg-danger-soft text-danger" } as const;

/** One run of the assistant as a timeline: what came in, each step it took, and what it replied. */
export function AgentTrace({ run, compact, t = same }: { run: Pick<AgentRun, "input" | "steps" | "reply" | "provider" | "ms" | "at">; compact?: boolean; t?: T }) {
  const steps = JSON.parse(run.steps) as Step[];
  return (
    <div className="text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">“{run.input || t("Message")}”</span>
        <span className="shrink-0">
          {new Date(run.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {(run.ms / 1000).toFixed(1)} s
        </span>
      </div>
      <ol className="relative flex flex-col gap-2.5 border-l border-line pl-4">
        {steps.map((s, i) => {
          const Icon = ICON[s.kind] ?? Bot;
          return (
            <li key={i} className="relative">
              <span className={`absolute top-0.5 -left-[25px] grid size-[18px] place-items-center rounded-full ring-2 ring-surface ${s.tone ? TONE[s.tone] : "bg-primary-soft text-primary"}`} aria-hidden>
                <Icon className="size-3" />
              </span>
              <div className="font-medium leading-snug">{s.label}</div>
              {s.detail && !compact && <div className="mt-0.5 text-xs break-words text-muted">{s.detail}</div>}
            </li>
          );
        })}
      </ol>
      {run.reply && !compact && (
        <div className="mt-3 rounded-lg bg-subtle p-2.5 text-xs">
          <div className="mb-0.5 font-medium text-muted">{t("Replied")}</div>
          <div className="whitespace-pre-wrap">{run.reply}</div>
        </div>
      )}
    </div>
  );
}
