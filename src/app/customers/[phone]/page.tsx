import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarClock, Gauge, ReceiptText, Wallet } from "lucide-react";
import { creditDays, invoiceNo, payable, paymentGrade, unpaidBills } from "@/lib/billing";
import { db, type Customer, type Order } from "@/lib/db";
import { LANG_NAMES, normLang } from "@/lib/i18n";
import { now, outstanding, regularItems } from "@/lib/insights";
import { Card, CardHead, Empty, Header, inr, inrShort, PAYS, Pill, ROW, Stat, StatusPill, TD, TH } from "@/components/ui";
import { OutreachButton } from "@/components/outreach-button";
import { RetailerForm } from "@/components/retailer-form";

export default function RetailerPage({ params }: PageProps<"/customers/[phone]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Retailer params={params} />
    </Suspense>
  );
}

const DAY = 86_400_000;

async function Retailer({ params }: Pick<PageProps<"/customers/[phone]">, "params">) {
  await connection();
  const t = await getT();
  const { phone } = await params;
  const d = db();
  const c = d.prepare("SELECT * FROM customers WHERE phone = ?").get(phone) as Customer | undefined;
  if (!c) notFound();
  const orders = d.prepare("SELECT * FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 50").all(phone) as Order[];
  const billed = orders.filter((o) => ["paid", "confirmed_cod", "awaiting_payment"].includes(o.status));
  const month = billed.filter((o) => o.created_at >= now() - 30 * DAY);
  const due = outstanding(phone);
  const bills = unpaidBills(phone).map((b) => ({ b, p: payable(b) }));
  const overdue = bills.filter((x) => x.p.overdueDays > 0);
  const grade = paymentGrade(phone);
  const saved = (d.prepare("SELECT COALESCE(SUM(discount), 0) AS v FROM orders WHERE phone = ? AND status = 'paid'").get(phone) as { v: number }).v;
  const regular = regularItems(phone);
  const LICENCE: Record<string, { tone: "green" | "amber" | "red" | "gray"; label: string }> = {
    verified: { tone: "green", label: "Verified" },
    pending: { tone: "amber", label: "Waiting for your check" },
    rejected: { tone: "red", label: "Rejected" },
    none: { tone: c.drug_licence ? "amber" : "red", label: c.drug_licence ? "Not checked yet" : "Not on file" },
  };
  const licence = LICENCE[c.licence_status] ?? LICENCE.none;
  const licenceExpired = !!c.licence_expiry && new Date(c.licence_expiry).getTime() < now();

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t("Retailers")}
      </Link>
      <Header title={c.name} sub={[c.city, `+${c.phone}`, t("Orders in {language}", { language: LANG_NAMES[normLang(c.language)] })].filter(Boolean).join(" · ")} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t("How they pay")}
          value={t(PAYS[grade.grade].label)}
          icon={Gauge}
          tone={PAYS[grade.grade].tone}
          hint={`${grade.hint}${saved ? ` · ${t("saved {amount} paying early", { amount: inr(Math.round(saved)) })}` : ""}`}
        />
        <Stat label={t("Bought, last 30 days")} value={inrShort(month.reduce((s, o) => s + o.total, 0))} icon={ReceiptText} tone="blue" hint={t("{n} orders · average {amount}", { n: month.length, amount: inrShort(billed.length ? billed.reduce((s, o) => s + o.total, 0) / billed.length : 0) })} />
        <Stat
          label={t("Owes you")}
          value={inrShort(due)}
          icon={Wallet}
          tone={due > c.credit_limit ? "red" : "amber"}
          hint={`${t("Credit limit {amount}", { amount: inr(c.credit_limit) })}${due > c.credit_limit ? ` · ${t("over the limit")}` : ""}`}
        />
        <Stat
          label={t("Late payments")}
          value={overdue.length ? inrShort(overdue.reduce((s, x) => s + x.b.total, 0)) : t("None")}
          icon={CalendarClock}
          tone={overdue.length ? "red" : "green"}
          hint={overdue.length ? t("{n} days late · next orders must be paid first", { n: Math.max(...overdue.map((x) => x.p.overdueDays)) }) : t("They get {days} days to pay", { days: creditDays() })}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="overflow-hidden">
            <CardHead title={t("What they usually buy")} sub={t("And whether they are likely to need it again soon")}>
              {regular.some((r) => r.dueAgain) && <OutreachButton kind="reorder" phone={c.phone} label={t("Send a reminder")} />}
            </CardHead>
            {regular.length ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>{["Item", "Usual quantity", "How often", "Last bought", ""].map((h, i) => <th key={i} className={TH}>{h && t(h)}</th>)}</tr></thead>
                  <tbody>
                    {regular.map((r) => (
                      <tr key={r.item_id} className={ROW}>
                        <td className={`${TD} font-medium`}>{r.name}</td>
                        <td className={TD}>{r.avg_qty}</td>
                        <td className={`${TD} text-muted`}>{t("about every {n} days", { n: r.every })}</td>
                        <td className={`${TD} text-muted`}>{new Date(r.last_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                        <td className={TD}>{r.dueAgain && <Pill tone="blue">{t("May need it now")}</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={ReceiptText} title={t("Not enough history yet")}>{t("Items show up here once they have bought them twice.")}</Empty>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHead title={t("Order history")} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{["Order", "Date", "Total", "Status"].map((h) => <th key={h} className={TH}>{t(h)}</th>)}</tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className={ROW}>
                      <td className={TD}><Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">#{o.id}</Link></td>
                      <td className={`${TD} text-muted`}>{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                      <td className={TD}>{o.total ? inr(o.total) : "—"}</td>
                      <td className={TD}><StatusPill status={o.status} t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!orders.length && <Empty icon={ReceiptText} title={t("No orders yet")} />}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
        <Card>
          <CardHead title={t("Unpaid bills")}>{bills.length > 0 && <OutreachButton kind="dues" phone={c.phone} label={t("Send reminder")} primary />}</CardHead>
          <ul className="flex flex-col gap-2 px-5 pb-5 text-sm">
            {bills.map(({ b, p }) => (
              <li key={b.id} className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/orders/${b.id}`} className="font-medium text-primary hover:underline">{invoiceNo(b)}</Link>
                  <div className="text-xs text-muted">
                    {p.overdueDays ? <span className="text-danger">{t("{n} days late", { n: p.overdueDays })}</span> : t("Due {date}", { date: new Date(p.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) })}
                    {p.discount > 0 && ` · ${t("pay {amount} today ({pct}% off)", { amount: inr(p.amount), pct: p.pct })}`}
                  </div>
                </div>
                <span className="num shrink-0">{inr(b.total)}</span>
              </li>
            ))}
            {!bills.length && <li className="text-muted">{t("No unpaid bills.")}</li>}
          </ul>
        </Card>
        <Card>
          <CardHead title={t("Licence and credit")} sub={t("Licence-only medicines need a checked drug licence. Late bills stop new credit.")}>
            <Pill tone={licenceExpired ? "red" : licence.tone}><BadgeCheck className="size-3" aria-hidden />{licenceExpired ? t("Expired") : t(licence.label)}</Pill>
          </CardHead>
          <RetailerForm phone={c.phone} initial={{ city: c.city, drug_licence: c.drug_licence, licence_forms: c.licence_forms, licence_expiry: c.licence_expiry ?? "", verified: c.licence_status === "verified", gstin: c.gstin, credit_limit: c.credit_limit }} />
        </Card>
        </div>
      </div>
    </>
  );
}
