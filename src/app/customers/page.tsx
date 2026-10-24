import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { AlertTriangle, ShieldCheck, Store, Users, Wallet } from "lucide-react";
import { db, type Customer } from "@/lib/db";
import { paymentGrade } from "@/lib/billing";
import { daysSince, now } from "@/lib/insights";
import { OutreachButton } from "@/components/outreach-button";
import { Card, Empty, Header, inr, inrShort, PAYS, Pill, ROW, Stat, TD, TH } from "@/components/ui";

export default function CustomersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Customers />
    </Suspense>
  );
}

type Row = Customer & { orders: number; billed: number; due: number; oldest_due: number | null; last_at: number | null };

async function Customers() {
  await connection();
  const t = await getT();
  const since = now() - 30 * 86_400_000;
  const rows = db()
    .prepare(
      `SELECT c.*,
        COUNT(CASE WHEN o.created_at >= ? THEN 1 END) AS orders,
        COALESCE(SUM(CASE WHEN o.created_at >= ? AND o.status IN ('paid','confirmed_cod','awaiting_payment') THEN o.total END), 0) AS billed,
        COALESCE(SUM(CASE WHEN o.status IN ('awaiting_payment','confirmed_cod') THEN o.total END), 0) AS due,
        MIN(CASE WHEN o.status IN ('awaiting_payment','confirmed_cod') THEN o.updated_at END) AS oldest_due,
        MAX(o.created_at) AS last_at
       FROM customers c LEFT JOIN orders o ON o.phone = c.phone GROUP BY c.phone ORDER BY billed DESC, c.created_at DESC`,
    )
    .all(since, since) as Row[];
  const totalDue = rows.reduce((s, r) => s + r.due, 0);
  const over = rows.filter((r) => r.due > r.credit_limit).length;
  const noLicence = rows.filter((r) => r.licence_status !== "verified").length;

  return (
    <>
      <Header title={t("Retailers")} sub={t("The shops that order from you on WhatsApp: what they owe, how they pay, and their drug licence.")}>
        <OutreachButton kind="dues" label={t("Remind everyone who is late")} />
      </Header>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("Retailers")} value={rows.length} icon={Users} tone="blue" hint={t("{n} ordered in the last 30 days", { n: rows.filter((r) => r.orders).length })} />
        <Stat label={t("Retailers owe you")} value={inrShort(totalDue)} icon={Wallet} tone="amber" hint={t("All unpaid bills")} />
        <Stat label={t("Over their credit limit")} value={over} icon={AlertTriangle} tone={over ? "red" : "gray"} hint={t("Their next order needs your OK")} />
        <Stat label={t("Licence not checked")} value={noLicence} icon={ShieldCheck} tone={noLicence ? "red" : "gray"} hint={t("Licence-only medicines need your OK")} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>{["Retailer", "Drug licence", "How they pay", "Orders this month", "Owes you", "Last order"].map((h) => <th key={h} className={TH}>{t(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const pct = Math.min(100, (c.due / Math.max(1, c.credit_limit)) * 100);
                const oldest = c.oldest_due ? daysSince(c.oldest_due) : null;
                return (
                  <tr key={c.phone} className={ROW}>
                    <td className={TD}>
                      <Link href={`/customers/${c.phone}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                      <div className="text-xs text-muted">{c.city || `+${c.phone}`}</div>
                    </td>
                    <td className={TD}>
                      {c.licence_status === "verified" ? <Pill tone="green">{t("Checked")}</Pill> : c.licence_status === "pending" ? <Pill tone="amber">{t("Please check")}</Pill> : c.drug_licence ? <Pill tone="amber">{t("Not checked")}</Pill> : <Pill tone="red">{t("Missing")}</Pill>}
                    </td>
                    <td className={TD}>
                      {(() => {
                        const g = paymentGrade(c.phone);
                        return <span title={g.hint}><Pill tone={PAYS[g.grade].tone}>{t(PAYS[g.grade].label)}</Pill>{g.avgDays !== null && <div className="mt-0.5 text-xs text-muted">{t("in about {n} days", { n: Math.max(1, Math.round(g.avgDays)) })}</div>}</span>;
                      })()}
                    </td>
                    <td className={TD}>{c.orders}<div className="text-xs text-muted">{inr(Math.round(c.billed))}</div></td>
                    <td className={`${TD} min-w-44`}>
                      <div className="flex justify-between gap-2 text-xs">
                        <span className={`num font-medium ${c.due > c.credit_limit ? "text-danger" : ""}`}>{inrShort(c.due)}</span>
                        <span className="num text-muted">{t("of {amount}", { amount: inrShort(c.credit_limit) })}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-subtle">
                        <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-success"}`} style={{ width: `${pct}%` }} />
                      </div>
                      {oldest !== null && oldest >= 1 && <div className="mt-1 text-xs text-muted">{t("Oldest bill: {n} days", { n: oldest })}</div>}
                    </td>
                    <td className={`${TD} text-muted`}>{c.last_at ? new Date(c.last_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty icon={Store} title={t("No retailers yet")}>{t("A retailer is added the first time they message your WhatsApp number.")}</Empty>}
      </Card>
    </>
  );
}
