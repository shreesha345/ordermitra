import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { T } from "@/lib/ui-lang";

const same: T = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);

export function Header({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

const TONES = {
  green: "bg-success-soft text-success",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
  blue: "bg-primary-soft text-primary",
  gray: "bg-subtle text-muted",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        {label}
        {Icon && (
          <span className={`grid size-8 place-items-center rounded-lg ${TONES[tone ?? "gray"]}`}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <div className="num mt-2 text-[26px] leading-tight font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-subtle text-muted">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Detail most people do not need: folded away until asked for. */
export function More({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group rounded-xl border border-line bg-surface ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-sm font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        {label}
        <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

export const STATUS: Record<string, { tone: Tone; label: string }> = {
  awaiting_approval: { tone: "gray", label: "Waiting for retailer to confirm" },
  awaiting_customer: { tone: "amber", label: "Some items short, retailer choosing" },
  awaiting_confirm: { tone: "amber", label: "Waiting for retailer to confirm" },
  awaiting_review: { tone: "red", label: "Needs your OK" },
  awaiting_payment: { tone: "amber", label: "Bill sent, not paid yet" },
  paid: { tone: "green", label: "Paid" },
  confirmed_cod: { tone: "blue", label: "On credit, not paid yet" },
  cancelled: { tone: "red", label: "Cancelled" },
};

export function StatusPill({ status, t = same }: { status: string; t?: T }) {
  const s = STATUS[status] ?? { tone: "gray" as const, label: status };
  return <Pill tone={s.tone}>{t(s.label)}</Pill>;
}

/** How fast a retailer pays, in words instead of a grade letter. */
export const PAYS: Record<string, { tone: Tone; label: string }> = {
  A: { tone: "green", label: "Pays fast" },
  B: { tone: "blue", label: "Pays on time" },
  C: { tone: "amber", label: "Pays slowly" },
  D: { tone: "red", label: "Pays late" },
  New: { tone: "gray", label: "New" },
};

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** ₹1.2L / ₹3.4K for tiles where space is tight. */
export const inrShort = (n: number) => {
  const f = (v: number, s: string) => `₹${Number(v.toFixed(1))}${s}`;
  return n >= 1e7 ? f(n / 1e7, "Cr") : n >= 1e5 ? f(n / 1e5, "L") : n >= 1e3 ? f(n / 1e3, "K") : inr(Math.round(n));
};

export function ago(at: number, t: T = same) {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return t("just now");
  if (m < 60) return t("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n} h ago", { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t("yesterday") : t("{n} days ago", { n: d });
}

export const SOURCE: Record<string, string> = { voice: "Voice note", text: "Text", image: "Photo", document: "PDF", sheet: "Excel sheet" };

export const TH = "px-4 py-2.5 text-left text-xs font-medium text-muted bg-subtle/70 whitespace-nowrap";
export const TD = "px-4 py-3 text-sm align-middle";
export const ROW = "border-t border-line transition-colors hover:bg-subtle/50";

export const BTN = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-primary text-white hover:bg-primary-hover`;
export const BTN_SECONDARY = `${BTN} border border-line bg-surface text-ink hover:bg-subtle`;
export const BTN_DANGER = `${BTN} border border-line bg-surface text-danger hover:bg-danger-soft`;
export const INPUT = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
