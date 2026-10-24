import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, IndianRupee, MessageCircle, ReceiptText, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { demoAllowed } from "@/lib/demo";
import { LANG_NAMES, normLang } from "@/lib/i18n";
import { attention, callMinutes, NEAR_EXPIRY_DAYS, stockView } from "@/lib/insights";
import { storeName } from "@/lib/brand";
import { getT } from "@/lib/ui-lang-server";
import { BarChart, BarList } from "@/components/bar-chart";
import { Briefing } from "@/components/briefing";
import { DemoButton } from "@/components/demo-button";
import { BTN_PRIMARY, BTN_SECONDARY, Card, CardHead, Empty, Header, inr, inrShort, More, Pill, SOURCE, Stat } from "@/components/ui";

export default function TodayPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Today />
    </Suspense>
  );
}

const DAY = 86_400_000;
const BILLED = "('paid','confirmed_cod','awaiting_payment')";

async function Today() {
  await connection();
  const t = await getT();
  const d = db();
  const today = new Date().setHours(0, 0, 0, 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const start = today - 13 * DAY;

  const orders = d.prepare(`SELECT status, total, source, language, created_at FROM orders WHERE created_at >= ?`).all(Math.min(start, monthStart)) as {
    status: string; total: number; source: string; language: string; created_at: number;
  }[];
  const billed = (s: string) => ["paid", "confirmed_cod", "awaiting_payment"].includes(s);

  const days = Array.from({ length: 14 }, (_, i) => {
    const from = start + i * DAY;
    const day = orders.filter((o) => o.created_at >= from && o.created_at < from + DAY);
    return {
      label: new Date(from).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      value: day.filter((o) => billed(o.status)).reduce((s, o) => s + o.total, 0),
      detail: t(day.length === 1 ? "{n} order" : "{n} orders", { n: day.length }),
    };
  });
  const todays = orders.filter((o) => o.created_at >= today);
  const yesterday = orders.filter((o) => o.created_at >= today - DAY && o.created_at < today).length;
  const month = orders.filter((o) => o.created_at >= monthStart);
  const hoursSaved = (month.length * callMinutes()) / 60;
  const { due, retailers } = d
    .prepare(`SELECT COALESCE(SUM(total), 0) AS due, COUNT(DISTINCT phone) AS retailers FROM orders WHERE status IN ('awaiting_payment','confirmed_cod')`)
    .get() as { due: number; retailers: number };

  const recent = orders.filter((o) => o.created_at >= start);
  const count = (key: (o: (typeof orders)[number]) => string) =>
    [...recent.reduce((m, o) => m.set(key(o), (m.get(key(o)) ?? 0) + 1), new Map<string, number>())]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

  const top = d
    .prepare(
      `SELECT l.name AS label, SUM(l.qty_confirmed) AS qty, SUM(l.qty_confirmed * l.unit_price) AS value FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.status IN ${BILLED} AND o.created_at >= ? GROUP BY l.item_id ORDER BY value DESC LIMIT 5`,
    )
    .all(today - 6 * DAY) as { label: string; qty: number; value: number }[];
  const queue = attention();
  const stock = stockView();
  const expiring = stock.filter((i) => i.expiryDays !== null && i.expiryDays <= NEAR_EXPIRY_DAYS && i.stock > 0);
  const low = stock.filter((i) => i.free <= i.min_stock);
  const lowIds = new Set(low.map((i) => i.id));

  const hour = new Date().getHours();
  const hello = t(hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");
  const date = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  if (!orders.length && !d.prepare("SELECT 1 FROM orders LIMIT 1").get()) {
    return (
      <>
        <Header title={`${hello}, ${storeName()}`} sub={date} />
        <Card>
          <Empty icon={MessageCircle} title={t("No orders yet")}>
            {t("When a retailer sends an order on WhatsApp, it shows up here. You can try it yourself in Practice chat, or load sample orders to look around.")}
            <div className="mt-4 flex justify-center gap-2">
              <Link href="/simulator" className={BTN_PRIMARY}>{t("Open Practice chat")}</Link>
              {demoAllowed() && <DemoButton />}
            </div>
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <Header title={`${hello}, ${storeName()}`} sub={`${date} · ${t("Here is what needs you today.")}`}>
        {demoAllowed() && <DemoButton label={t("Reset sample data")} />}
        <Link href="/simulator" className={BTN_SECONDARY}>
          <MessageCircle className="size-4" aria-hidden /> {t("Practice chat")}
        </Link>
      </Header>

      <div className="mb-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_380px]">
        <Briefing />
        <Card className="flex flex-col">
          <CardHead title={t("Orders waiting for you")} sub={t("Open one to see what to do")}>
            {queue.length > 0 && <Pill tone="red">{queue.length}</Pill>}
          </CardHead>
          {queue.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {queue.slice(0, 5).map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex gap-3 px-5 py-3 hover:bg-subtle/60">
                    <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${o.reasons.some((r) => r.tone === "red") ? "text-danger" : "text-warn"}`} aria-hidden />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="truncate font-medium">{o.name}</span>
                        {o.total > 0 && <span className="num shrink-0 text-muted">{inr(o.total)}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">{t(o.reasons[0].text)}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={CheckCircle2} title={t("All clear")}>{t("No order is waiting for you.")}</Empty>
          )}
          {queue.length > 5 && (
            <Link href="/orders?view=attention" className="mt-auto flex items-center gap-1 border-t border-line px-5 py-3 text-sm font-medium text-primary">
              {t("See all {n}", { n: queue.length })} <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </Card>
      </div>

      <h2 className="mb-3 text-[15px] font-semibold">{t("Your numbers")}</h2>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t("New orders today")}
          value={todays.length}
          icon={ReceiptText}
          tone="blue"
          hint={yesterday ? t("Yesterday: {n}", { n: yesterday }) : t("None yesterday")}
        />
        <Stat
          label={t("Sales today")}
          value={inrShort(todays.filter((o) => billed(o.status)).reduce((s, o) => s + o.total, 0))}
          icon={IndianRupee}
          tone="green"
          hint={t("Bills sent today, paid or not")}
        />
        <Stat label={t("Retailers owe you")} value={inrShort(due)} icon={Wallet} tone="amber" hint={t(retailers === 1 ? "From {n} retailer" : "From {n} retailers", { n: retailers })} />
        <Stat
          label={t("Time saved this month")}
          value={t("{n} hours", { n: hoursSaved.toFixed(1) })}
          icon={Clock}
          tone="blue"
          hint={t("{n} orders came on WhatsApp instead of phone calls", { n: month.length })}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px_340px]">
        <Card>
          <CardHead title={t("Sales, last 2 weeks")} sub={t("Touch a bar to see that day")} />
          <BarChart data={days} label={t("Sales per day, last 2 weeks")} format={inrShort} />
        </Card>
        <Card>
          <CardHead title={t("Best sellers this week")} />
          <BarList rows={top.map((x) => ({ label: `${x.label} · ${x.qty}`, value: x.value }))} format={inrShort} />
        </Card>
        <Card>
          <CardHead title={t("Stock to watch")} sub={t("Running low, or expiring in the next 3 months")}>
            <Link href="/inventory" className="text-xs font-medium text-primary">{t("Stock")}</Link>
          </CardHead>
          <ul className="flex flex-col gap-2.5 px-5 pb-5 text-sm">
            {low.slice(0, 4).map((i) => (
              <li key={`l${i.id}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{i.name}</span>
                <Pill tone={i.free ? "amber" : "red"}>{i.free ? t("{n} left", { n: i.free }) : t("Finished")}</Pill>
              </li>
            ))}
            {expiring.filter((i) => !lowIds.has(i.id)).slice(0, 3).map((i) => (
              <li key={`e${i.id}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{i.name}</span>
                <Pill tone={i.expiryDays! <= 30 ? "red" : "amber"}>{t("Expires in {n} days", { n: i.expiryDays! })}</Pill>
              </li>
            ))}
            {!low.length && !expiring.length && <li className="text-muted">{t("Nothing to worry about.")}</li>}
          </ul>
        </Card>
      </div>

      <More label={t("How retailers send orders, and in which language")}>
        <div className="grid grid-cols-1 gap-6 p-1 md:grid-cols-2">
          <div>
            <CardHead title={t("Sent as")} sub={t("Last 2 weeks")} />
            <BarList rows={count((o) => t(SOURCE[o.source] ?? o.source))} />
          </div>
          <div>
            <CardHead title={t("Languages")} sub={t("Last 2 weeks")} />
            <BarList rows={count((o) => LANG_NAMES[normLang(o.language)])} />
          </div>
        </div>
      </More>
    </>
  );
}
