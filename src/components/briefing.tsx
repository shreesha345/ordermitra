import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { briefingItems, briefingSummary, type BriefItem } from "@/lib/briefing";
import { getT, uiLang } from "@/lib/ui-lang-server";
import { OutreachButton } from "./outreach-button";
import { BTN_SECONDARY, Card } from "./ui";

const DOT = { red: "bg-danger", amber: "bg-warn", blue: "bg-primary", green: "bg-success" };

async function Summary({ items }: { items: BriefItem[] }) {
  const s = await briefingSummary(items, await uiLang());
  return <p className="text-[15px] leading-relaxed">{s.text}</p>;
}

/** The to-do list for today: a short summary on top, then each thing worth doing with a one-click action. */
export async function Briefing() {
  const t = await getT();
  const items = briefingItems(t);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line bg-gradient-to-br from-primary-soft to-surface px-5 py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> {t("To do today")}
        </h2>
        <Suspense fallback={<p className="text-[15px] text-muted">{t("Looking at today's orders, payments and stock…")}</p>}>
          <Summary items={items} />
        </Suspense>
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <span className={`size-2.5 shrink-0 rounded-full ${DOT[i.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{i.title}</div>
                <div className="mt-0.5 text-xs text-muted">{i.detail}</div>
              </div>
              {i.action?.kind === "remind" && <OutreachButton kind={i.action.remind} label={i.action.label} />}
              {i.action?.kind === "link" && (
                <Link href={i.action.href} className={BTN_SECONDARY}>
                  {i.action.label} <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <CheckCircle2 className="size-4 text-success" aria-hidden /> {t("Nothing else to do right now.")}
        </p>
      )}
    </Card>
  );
}
