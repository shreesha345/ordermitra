import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { LANG_NAMES, normLang } from "@/lib/i18n";
import { Card, Header, inr, TD, TH } from "@/components/ui";

export default function CustomersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading customers…</p>}>
      <Customers />
    </Suspense>
  );
}

async function Customers() {
  await connection();
  const rows = db()
    .prepare(
      `SELECT c.*, COUNT(o.id) AS orders,
        COALESCE(SUM(CASE WHEN o.status IN ('paid','confirmed_cod') THEN o.total END), 0) AS spent,
        MAX(o.id) AS last_order
       FROM customers c LEFT JOIN orders o ON o.phone = c.phone GROUP BY c.phone ORDER BY c.created_at DESC`,
    )
    .all() as { phone: string; name: string; language: string; orders: number; spent: number; last_order: number | null }[];

  return (
    <>
      <Header title="Customers" sub="Everyone who has messaged your WhatsApp number. Their language is the one they picked on WhatsApp." />
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>{["Customer", "WhatsApp number", "Language", "Orders", "Total spent", "Last order"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.phone} className="border-t border-line">
                <td className={`${TD} font-medium`}>{c.name}</td>
                <td className={`${TD} text-muted`}>+{c.phone}</td>
                <td className={`${TD} text-muted`}>{LANG_NAMES[normLang(c.language)]}</td>
                <td className={TD}>{c.orders}</td>
                <td className={TD}>{inr(c.spent)}</td>
                <td className={TD}>{c.last_order ? <Link href={`/orders/${c.last_order}`} className="text-primary">#{c.last_order}</Link> : "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="p-10 text-center text-sm text-muted">No customers yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
