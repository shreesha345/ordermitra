import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getLines, getOrder } from "@/lib/orders";
import { LANG_NAMES, normLang } from "@/lib/i18n";
import { Card, Header, inr, Pill, StatusPill, TD, TH } from "@/components/ui";
import { OrderActions } from "@/components/order-actions";

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading order…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}

const LINE: Record<string, { tone: "green" | "amber" | "red" | "gray"; label: string }> = {
  pending: { tone: "gray", label: "Not checked yet" },
  available: { tone: "green", label: "Available" },
  short: { tone: "amber", label: "Short, waiting on customer" },
  out: { tone: "red", label: "Out of stock" },
  dropped: { tone: "red", label: "Dropped by customer" },
  not_needed: { tone: "gray", label: "Not needed" },
  unmatched: { tone: "gray", label: "Not in inventory" },
};

async function Detail({ params }: Pick<PageProps<"/orders/[id]">, "params">) {
  await connection();
  const { id } = await params;
  const order = getOrder(Number(id));
  if (!order) notFound();
  const lines = getLines(order.id);
  const customer = db().prepare("SELECT name FROM customers WHERE phone = ?").get(order.phone) as { name: string } | undefined;
  const stock = new Map(
    (db().prepare("SELECT id, stock, reserved FROM items").all() as { id: number; stock: number; reserved: number }[]).map((i) => [i.id, i]),
  );
  const moves = db()
    .prepare("SELECT m.*, i.name FROM stock_movements m JOIN items i ON i.id = m.item_id WHERE m.order_id = ? ORDER BY m.id")
    .all(order.id) as { id: number; name: string; change: number; kind: string; at: number }[];

  return (
    <>
      <Header
        title={`Order #${order.id}`}
        sub={`${customer?.name ?? ""} · +${order.phone} · ${new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
      >
        <StatusPill status={order.status} />
        <OrderActions id={order.id} status={order.status} />
        {order.total > 0 && (
          <a href={`/api/orders/${order.id}/invoice`} target="_blank" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
            ↓ Download invoice (PDF)
          </a>
        )}
      </Header>
      <div className="grid grid-cols-[1fr_340px] items-start gap-6">
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Customer message</h2>
              <Pill tone="blue">{LANG_NAMES[normLang(order.language)]}</Pill>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-line p-3">
                <div className="mb-1 text-xs text-muted">What they said</div>
                {order.transcript || "—"}
              </div>
              <div className="rounded-lg border border-line p-3">
                <div className="mb-1 text-xs text-muted">Understood in English</div>
                {order.understood || "—"}
              </div>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <h2 className="p-5 text-lg font-semibold">What the customer needs vs. your stock</h2>
            <table className="w-full">
              <thead>
                <tr>
                  {["They said", "Matched item", "Asked", "Confirmed", "Free now", "Price", "Result"].map((h) => (
                    <th key={h} className={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const s = l.item_id ? stock.get(l.item_id) : undefined;
                  const r = LINE[l.status];
                  return (
                    <tr key={l.id} className="border-t border-line">
                      <td className={`${TD} text-muted`}>“{l.said}”</td>
                      <td className={TD}>{l.status === "unmatched" ? "—" : l.name}</td>
                      <td className={TD}>×{l.qty_requested}</td>
                      <td className={TD}>{l.qty_confirmed ? `×${l.qty_confirmed}` : "—"}</td>
                      <td className={`${TD} text-muted`}>{s ? Math.max(0, s.stock - s.reserved) : "—"}</td>
                      <td className={TD}>{l.item_id ? inr(l.unit_price) : "—"}</td>
                      <td className={TD}><Pill tone={r.tone}>{r.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-hidden">
            <h2 className="p-5 text-lg font-semibold">Inventory updates for this order</h2>
            <table className="w-full">
              <thead>
                <tr>{["Item", "Change", "Type", "Time"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className={TD}>{m.name}</td>
                    <td className={TD}>{m.change > 0 ? `+${m.change}` : m.change}</td>
                    <td className={TD}>
                      <Pill tone={m.kind === "deducted" ? "green" : m.kind === "reserved" ? "amber" : "gray"}>
                        {m.kind === "reserved" ? "Reserved" : m.kind === "deducted" ? "Deducted" : "Released"}
                      </Pill>
                    </td>
                    <td className={`${TD} text-muted`}>{new Date(m.at).toLocaleTimeString("en-IN", { timeStyle: "short" })}</td>
                  </tr>
                ))}
                {!moves.length && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-sm text-muted">
                      Stock is reserved when the bill is sent and deducted when the customer pays or confirms.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">Bill #INV-{order.id}</h2>
          <div className="flex flex-col gap-2 text-sm">
            {lines.filter((l) => l.qty_confirmed > 0).map((l) => (
              <div key={l.id} className="flex justify-between gap-3">
                <span className="text-muted">{l.name} × {l.qty_confirmed}</span>
                <span>{inr(l.qty_confirmed * l.unit_price)}</span>
              </div>
            ))}
            <div className="my-1 border-t border-line" />
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{inr(order.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted">GST (5%)</span><span>{inr(order.gst)}</span></div>
            <div className="mt-1 flex justify-between text-lg font-bold"><span>Total</span><span>{inr(order.total)}</span></div>
          </div>
          {order.payment_method && (
            <div className="mt-4 rounded-lg bg-success-soft p-3 text-sm text-success">
              {order.payment_method === "upi" ? `Paid via UPI · ref ${order.pay_ref}` : "Confirmed · pay on delivery"}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
