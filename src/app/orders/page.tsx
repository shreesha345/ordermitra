import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { db, type Item, type Order } from "@/lib/db";
import { LANG_NAMES, normLang } from "@/lib/i18n";
import { Card, Header, inr, Pill, Stat, StatusPill, TD, TH } from "@/components/ui";

export default function OrdersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading orders…</p>}>
      <Orders />
    </Suspense>
  );
}

type Row = Order & { customer: string | null; items: number };

async function Orders() {
  await connection();
  const d = db();
  const rows = d
    .prepare(
      `SELECT o.*, c.name AS customer,
        (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id AND l.status NOT IN ('not_needed','unmatched','dropped')) AS items
       FROM orders o LEFT JOIN customers c ON c.phone = o.phone ORDER BY o.id DESC LIMIT 100`,
    )
    .all() as Row[];
  const today = new Date().setHours(0, 0, 0, 0);
  const todays = rows.filter((r) => r.created_at >= today);
  const awaiting = rows.filter((r) => r.status === "awaiting_payment");
  const revenue = rows.filter((r) => r.status === "paid" && r.updated_at >= today).reduce((s, r) => s + r.total, 0);
  const alerts = d.prepare("SELECT * FROM items WHERE stock - reserved <= min_stock ORDER BY stock - reserved LIMIT 6").all() as Item[];

  return (
    <>
      <Header title="Orders" sub="Customers order by voice note on WhatsApp. Intova understands their language, checks your stock and sends the bill automatically." />
      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat label="Orders today" value={todays.length} />
        <Stat label="Awaiting payment" value={inr(awaiting.reduce((s, r) => s + r.total, 0))} tone="amber" />
        <Stat label="Paid today" value={inr(revenue)} tone="green" />
        <Stat label="Low or out of stock" value={alerts.length} tone={alerts.length ? "red" : undefined} />
      </div>
      <div className="grid grid-cols-[1fr_320px] items-start gap-6">
        <Card className="overflow-hidden">
          <div className="p-5 text-lg font-semibold">Recent voice orders</div>
          <table className="w-full">
            <thead>
              <tr>
                {["Order", "Customer", "Language", "Items", "Total", "Status", "Invoice"].map((h) => (
                  <th key={h} className={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-bg/60">
                  <td className={TD}><Link href={`/orders/${r.id}`} className="font-medium text-primary">#{r.id}</Link></td>
                  <td className={TD}>
                    <div className="font-medium">{r.customer ?? r.phone}</div>
                    <div className="text-xs text-muted">+{r.phone}</div>
                  </td>
                  <td className={`${TD} text-muted`}>{LANG_NAMES[normLang(r.language)]}</td>
                  <td className={`${TD} text-muted`}>{r.items} {r.items === 1 ? "item" : "items"}</td>
                  <td className={TD}>{r.total ? inr(r.total) : "—"}</td>
                  <td className={TD}><StatusPill status={r.status} /></td>
                  <td className={TD}>
                    {r.total > 0 ? (
                      <a href={`/api/orders/${r.id}/invoice`} target="_blank" className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-primary">↓ PDF</a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="p-10 text-center text-sm text-muted">No orders yet. They appear here when a customer sends a voice note on WhatsApp.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card className="p-5">
          <div className="mb-3 text-lg font-semibold">Stock alerts</div>
          <div className="flex flex-col gap-3">
            {alerts.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{i.name}</div>
                  <div className="text-xs text-muted">{Math.max(0, i.stock - i.reserved)} free</div>
                </div>
                <Pill tone={i.stock - i.reserved <= 0 ? "red" : "amber"}>{i.stock - i.reserved <= 0 ? "Out of stock" : "Low stock"}</Pill>
              </div>
            ))}
            {!alerts.length && <p className="text-sm text-muted">Everything is well stocked.</p>}
          </div>
        </Card>
      </div>
    </>
  );
}
