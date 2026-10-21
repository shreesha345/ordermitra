import type { ReactNode } from "react";

export function Header({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

const TONES = {
  green: "bg-success-soft text-success",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
  blue: "bg-primary-soft text-primary",
  gray: "bg-bg text-muted",
} as const;

export function Pill({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "green" | "amber" | "red" }) {
  const c = tone === "green" ? "text-success" : tone === "amber" ? "text-warn" : tone === "red" ? "text-danger" : "";
  return (
    <Card className="p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${c}`}>{value}</div>
    </Card>
  );
}

export const STATUS: Record<string, { tone: keyof typeof TONES; label: string }> = {
  awaiting_approval: { tone: "gray", label: "Awaiting approval" },
  awaiting_customer: { tone: "amber", label: "Awaiting customer" },
  awaiting_confirm: { tone: "amber", label: "Awaiting confirm" },
  awaiting_payment: { tone: "amber", label: "Awaiting payment" },
  paid: { tone: "green", label: "Paid" },
  confirmed_cod: { tone: "blue", label: "Confirmed (COD)" },
  cancelled: { tone: "red", label: "Cancelled" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "gray" as const, label: status };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export const TH = "px-4 py-3 text-left text-xs font-medium text-muted bg-bg";
export const TD = "px-4 py-3.5 text-sm";
