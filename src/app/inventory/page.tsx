import { Suspense } from "react";
import { connection } from "next/server";
import { db, type Item } from "@/lib/db";
import { Card, Header, inr, Pill, Stat, TD, TH } from "@/components/ui";
import { ImportPanel } from "@/components/import-panel";

export default function InventoryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading inventory…</p>}>
      <Inventory />
    </Suspense>
  );
}

async function Inventory() {
  await connection();
  const d = db();
  const items = d.prepare("SELECT * FROM items ORDER BY name").all() as Item[];
  const moves = d
    .prepare(
      `SELECT m.*, i.name, o.phone, c.name AS customer FROM stock_movements m
       JOIN items i ON i.id = m.item_id LEFT JOIN orders o ON o.id = m.order_id LEFT JOIN customers c ON c.phone = o.phone
       ORDER BY m.id DESC LIMIT 10`,
    )
    .all() as { id: number; name: string; change: number; kind: string; at: number; order_id: number | null; customer: string | null }[];
  const free = (i: Item) => Math.max(0, i.stock - i.reserved);

  return (
    <>
      <Header title="Inventory" sub="Upload your medicine list once. Every voice order is checked against it, including the brand, generic and local names customers use." />
      <ImportPanel />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Total medicines" value={items.length} />
        <Stat label="Low stock" value={items.filter((i) => free(i) > 0 && free(i) <= i.min_stock).length} tone="amber" />
        <Stat label="Out of stock" value={items.filter((i) => free(i) === 0).length} tone="red" />
      </div>
      <Card className="mb-6 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>{["Item", "Also called (brand / generic / local)", "Unit", "Price", "On hand", "Reserved", "Status"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className={TD}>
                  {i.name} {i.rx ? <span className="ml-1 rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">Rx</span> : null}
                </td>
                <td className={`${TD} text-muted`}>{i.aliases}</td>
                <td className={`${TD} text-muted`}>{i.unit}</td>
                <td className={TD}>{inr(i.price)}</td>
                <td className={`${TD} font-medium`}>{i.stock}</td>
                <td className={`${TD} text-muted`}>{i.reserved || "—"}</td>
                <td className={TD}>
                  {free(i) === 0 ? <Pill tone="red">Out of stock</Pill> : free(i) <= i.min_stock ? <Pill tone="amber">Low stock</Pill> : <Pill tone="green">In stock</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-hidden">
        <div className="p-5">
          <div className="text-lg font-semibold">Live stock movements</div>
          <div className="text-sm text-muted">Stock is reserved when a bill is sent and deducted when the customer pays or confirms. The next order is checked against these numbers.</div>
        </div>
        <table className="w-full">
          <thead>
            <tr>{["Item", "Change", "Order", "Time", "Type"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className={TD}>{m.name}</td>
                <td className={TD}>{m.change > 0 ? `+${m.change}` : m.change}</td>
                <td className={`${TD} text-muted`}>{m.order_id ? `#${m.order_id} · ${m.customer ?? ""}` : "Import"}</td>
                <td className={`${TD} text-muted`}>{new Date(m.at).toLocaleTimeString("en-IN", { timeStyle: "short" })}</td>
                <td className={TD}>
                  <Pill tone={m.kind === "deducted" ? "green" : m.kind === "reserved" ? "amber" : m.kind === "import" ? "blue" : "gray"}>
                    {m.kind[0].toUpperCase() + m.kind.slice(1)}
                  </Pill>
                </td>
              </tr>
            ))}
            {!moves.length && <tr><td colSpan={5} className="p-6 text-center text-sm text-muted">No stock movements yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
