import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { Bot, Check, CreditCard, Info, Mail, MessageCircle, Minus, Search, Server, type LucideIcon } from "lucide-react";
import { integrations, plainSettings, type Integration, type IntegrationStatus } from "@/lib/integrations";
import { Card, Header, More, Pill, type Tone } from "@/components/ui";
import type { T } from "@/lib/ui-lang";

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <List />
    </Suspense>
  );
}

const STATUS: Record<IntegrationStatus, { tone: Tone; label: string }> = {
  connected: { tone: "green", label: "Connected" },
  test: { tone: "blue", label: "Test mode" },
  partial: { tone: "amber", label: "Incomplete setup" },
  off: { tone: "gray", label: "Not set up" },
  planned: { tone: "gray", label: "Coming next" },
};

const ICON: Record<Integration["category"], LucideIcon> = {
  Messaging: MessageCircle,
  AI: Bot,
  Payments: CreditCard,
  Email: Mail,
  Search: Search,
  System: Server,
};

const PLAIN_ICON: Record<string, LucideIcon> = { whatsapp: MessageCircle, ai: Bot, pay: CreditCard, lookup: Search, email: Mail };

async function List() {
  await connection();
  const t = await getT();
  const all = integrations();
  const plain = plainSettings(all);

  return (
    <>
      <Header title={t("Settings")} sub={t("What is switched on for your business. Your technical person can change these.")} />
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plain.map((p) => {
          const Icon = PLAIN_ICON[p.id] ?? Server;
          const pill = p.on === "soon" ? <Pill tone="gray">{t("Coming soon")}</Pill> : p.on === "test" ? <Pill tone="amber">{t("Test mode")}</Pill> : p.on ? <Pill tone="green">{t("On")}</Pill> : <Pill tone="gray">{t("Off")}</Pill>;
          return (
            <Card key={p.id} className={`flex gap-3 p-5 ${p.on === "soon" ? "border-dashed" : ""}`}>
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${p.on === true ? "bg-success-soft text-success" : "bg-subtle text-muted"}`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{t(p.name)}</h2>
                  {pill}
                </div>
                <p className="mt-1 text-sm text-muted">{t(p.text)}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <More label={t("Technical details (for your technical person)")}>
        <p className="flex items-center gap-1.5 px-5 pt-4 text-sm text-muted">
          <Info className="size-4" aria-hidden /> {t("To connect a tool, add its keys to .env and restart the server.")}
        </p>
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
          {all.map((i) => <IntegrationCard key={i.id} i={i} t={t} />)}
        </div>
      </More>
    </>
  );
}

function IntegrationCard({ i, t }: { i: Integration; t: T }) {
  const Icon = ICON[i.category];
  const s = STATUS[i.status];
  return (
    <Card className={`flex flex-col p-5 ${i.status === "planned" ? "border-dashed" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{i.name}</h3>
            <Pill tone={s.tone}>{t(s.label)}</Pill>
          </div>
          <p className="mt-0.5 text-sm text-muted">{i.category} · {i.usedFor}</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-muted">{i.status === "planned" ? t("Will be able to") : t("What it can access")}</div>
        <ul className="flex flex-col gap-1 text-sm">
          {i.access.map((a) => (
            <li key={a} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-faint" aria-hidden />{a}</li>
          ))}
        </ul>
      </div>
      {i.note && <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">{i.note}</p>}
      {i.keys.length > 0 && (
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-4" aria-label={t("Environment keys")}>
          {i.keys.map((k) => (
            <li
              key={k.name}
              title={`${k.set ? t("Set") : t("Not set")}${k.required ? "" : ` (${t("optional")})`}`}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                k.set ? "border-success/30 bg-success-soft text-success" : k.required ? "border-line text-ink" : "border-line text-faint"
              }`}
            >
              {k.set ? <Check className="size-3" aria-label="set" /> : <Minus className="size-3" aria-label="not set" />}
              {k.name}
              {!k.required && !k.set && <span className="font-sans">({t("optional")})</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
