import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowDownRight, ArrowRight, ArrowUpRight, PackageCheck, PackageX, ShoppingCart, Sparkles, TrendingUp } from "lucide-react";
import { demandReport, WEEKS, type Demand, type Trend } from "@/lib/demand";
import { getT } from "@/lib/ui-lang-server";
import type { T } from "@/lib/ui-lang";
import { BarChart } from "@/components/bar-chart";
import { Card, CardHead, Empty, Header, inr, inrShort, More, Pill, ROW, Stat, TD, TH, type Tone } from "@/components/ui";

export default function DemandPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <DemandView />
    </Suspense>
  );
}

const TREND: Record<Trend, { tone: Tone; label: string; icon: typeof ArrowUpRight }> = {
  rising: { tone: "green", label: "Selling more", icon: ArrowUpRight },
  falling: { tone: "red", label: "Selling less", icon: ArrowDownRight },
  steady: { tone: "gray", label: "Steady", icon: ArrowRight },
  new: { tone: "blue", label: "New", icon: Sparkles },
  quiet: { tone: "gray", label: "No orders", icon: ArrowRight },
};

function TrendPill({ x, t }: { x: Demand; t: T }) {
  const s = TREND[x.trend];
  return (
    <Pill tone={s.tone}>
      <s.icon className="size-3" aria-hidden />
      {t(s.label)}
      {x.change !== null && x.trend !== "steady" ? ` ${x.change > 0 ? "+" : "−"}${Math.round(Math.abs(x.change) * 100)}%` : ""}
    </Pill>
  );
}

/** Weekly demand as a small line; the last point is the latest week. */
function Spark({ values, tone }: { values: number[]; tone: Tone }) {
  const w = 96, h = 28, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  const color = tone === "green" ? "var(--color-success)" : tone === "red" ? "var(--color-danger)" : "var(--color-primary)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={h - 2 - (values[values.length - 1] / max) * (h - 4)} r="2.25" fill={color} />
    </svg>
  );
}

const unitOf = (x: Demand) => x.item.unit;

async function DemandView() {
  await connection();
  const t = await getT();
  const r = demandReport();
  const total30 = r.best.reduce((s, x) => s + x.value30, 0);
  const forecastValue = r.list.reduce((s, x) => s + x.forecast30 * x.item.price, 0);
  const prevValue = r.list.reduce((s, x) => s + x.prev30 * x.item.price, 0);
  const growth = prevValue ? (total30 - prevValue) / prevValue : null;
  const toOrderValue = r.stockUp.reduce((s, x) => s + x.suggest * x.item.price, 0);
  const slowValue = r.slow.reduce((s, x) => s + x.free * x.item.price, 0);
  const weeks = r.weeklyValue.map((value, i) => ({ label: i === WEEKS - 1 ? t("This week") : t("{n} weeks ago", { n: WEEKS - 1 - i }), value }));

  return (
    <>
      <Header
        title={t("What to buy")}
        sub={t("What is selling, what is picking up, and what to order before you run out. Worked out from your last 3 months of WhatsApp orders.")}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t("Asked for this month")}
          value={inrShort(total30)}
          icon={TrendingUp}
          tone={growth !== null && growth < -0.1 ? "amber" : "blue"}
          hint={growth === null ? undefined : t("{sign}{pct}% compared with last month", { sign: growth >= 0 ? "+" : "−", pct: Math.round(Math.abs(growth) * 100) })}
        />
        <Stat label={t("Expected next month")} value={inrShort(forecastValue)} icon={Sparkles} tone="blue" hint={t("Sales we expect, at today's prices")} />
        <Stat
          label={t("To buy now")}
          value={r.stockUp.length}
          icon={ShoppingCart}
          tone={r.stockUp.some((x) => x.runsOutIn !== null && x.runsOutIn <= r.lead) ? "red" : r.stockUp.length ? "amber" : "gray"}
          hint={r.stockUp.length ? t("About {amount} in total", { amount: inrShort(toOrderValue) }) : t("You have enough for the next month")}
        />
        <Stat label={t("Sales missed this month")} value={inrShort(r.missed)} icon={PackageX} tone={r.missed ? "red" : "gray"} hint={t("Retailers wanted it, but you had too little")} />
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHead
          title={t("Buy these now")}
          sub={t("Most urgent first. Each amount is enough for about a month, with a little extra in case sales jump.")}
        />
        {r.stockUp.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>{["Medicine", "Sales, last 3 months", "You have", "Finishes", "Buy", "Why"].map((h) => <th key={h} className={TH}>{t(h)}</th>)}</tr>
              </thead>
              <tbody>
                {r.stockUp.map((x) => (
                  <tr key={x.item.id} className={ROW}>
                    <td className={`${TD} max-w-56`}>
                      <div className="font-medium">{x.item.name}</div>
                      <TrendPill x={x} t={t} />
                    </td>
                    <td className={TD}><Spark values={x.weekly} tone={TREND[x.trend].tone} /></td>
                    <td className={TD}><span className="num">{x.free}</span> <span className="text-xs text-muted">{unitOf(x)}</span></td>
                    <td className={TD}>
                      {x.runsOutIn === null ? <span className="text-muted">—</span> : x.runsOutIn <= r.lead ? <Pill tone="red">{x.runsOutIn === 0 ? t("now") : x.runsOutIn === 1 ? t("tomorrow") : t("in {n} days", { n: x.runsOutIn })}</Pill> : <span className={x.runsOutIn <= 14 ? "text-warn" : ""}>{t("in {n} days", { n: x.runsOutIn })}</span>}
                    </td>
                    <td className={TD}>
                      <span className="num text-base font-semibold">{x.suggest}</span> <span className="text-xs text-muted">{unitOf(x)}</span>
                      <div className="text-xs text-muted">{inr(Math.round(x.suggest * x.item.price))}{x.item.box_qty > 1 ? ` · ${t("{n} boxes", { n: x.suggest / x.item.box_qty })}` : ""}</div>
                    </td>
                    <td className={`${TD} min-w-56 text-xs text-muted`}>
                      {x.reasons.map((k) => <div key={k}>{t(k, x.vars)}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={PackageCheck} title={t("Nothing to order")}>{t("Your stock covers the forecast for the next 30 days.")}</Empty>
        )}
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden">
          <CardHead title={t("Best sellers")} sub={t("This month, by value")} />
          <ol className="divide-y divide-line">
            {r.best.slice(0, 12).map((x, i) => (
              <li key={x.item.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="num w-5 shrink-0 text-right text-xs text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{x.item.name}</span>
                    <span className="num shrink-0">{inrShort(x.value30)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-subtle">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(x.value30 / Math.max(1, r.best[0].value30)) * 100}%` }} />
                    </div>
                    <span className="num shrink-0 text-xs text-muted">{x.last30} {unitOf(x)} · {Math.round((x.value30 / Math.max(1, total30)) * 100)}%</span>
                  </div>
                </div>
                <div className="shrink-0"><TrendPill x={x} t={t} /></div>
              </li>
            ))}
          </ol>
          {!r.best.length && <Empty icon={TrendingUp} title={t("No orders in the last 30 days")} />}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHead title={t("Orders each week")} sub={t("Value retailers asked for, at today's prices")} />
            <BarChart data={weeks} label={t("Orders each week")} format={inrShort} />
          </Card>
          <Card className="overflow-hidden">
            <CardHead title={t("Do not buy more of these")} sub={t("Selling slowly, and you have enough for over 2 months. Offer them to retailers instead.")} />
            {r.slow.length ? (
              <ul className="divide-y divide-line">
                {r.slow.slice(0, 8).map((x) => (
                  <li key={x.item.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{x.item.name}</div>
                      <div className="text-xs text-muted">
                        {x.free} {unitOf(x)} · {x.perDay ? t("lasts about {n} days", { n: Math.round(x.free / x.perDay) }) : t("no orders lately")}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <TrendPill x={x} t={t} />
                      <span className="num text-xs text-muted">{inr(Math.round(x.free * x.item.price))}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={PackageCheck} title={t("Nothing is selling slowly")} />
            )}
            {slowValue > 0 && <p className="px-5 pb-4 text-xs text-muted">{t("{amount} of stock is moving slowly.", { amount: inr(Math.round(slowValue)) })}</p>}
          </Card>
        </div>
      </div>

      <More label={t("How these numbers are worked out")}>
        <p className="px-5 py-4 text-sm text-muted">
          {t("How the forecast works: each product's weekly demand is smoothed into a level and a trend (Holt's method, with the trend fading over time), projected 30 days ahead. The safety buffer covers how far demand has strayed from the forecast in past weeks, over the supplier lead time ({n} days). Confidence is high with 8+ weeks of steady orders.", { n: r.lead })}
        </p>
      </More>
    </>
  );
}
