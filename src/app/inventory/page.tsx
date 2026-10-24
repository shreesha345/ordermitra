import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { CalendarX2, PackageMinus, Pill as PillIcon, SearchX, ShoppingCart } from "lucide-react";
import { atRisk, expiryReport, expiryRows } from "@/lib/batches";
import { db } from "@/lib/db";
import { NEAR_EXPIRY_DAYS, now, stockView, type StockView } from "@/lib/insights";
import { ago, BTN_SECONDARY, Card, CardHead, Empty, Header, inr, inrShort, More, Pill, ROW, Stat, TD, TH, type Tone } from "@/components/ui";
import { AddMedicine } from "@/components/add-medicine";
import { ImportPanel } from "@/components/import-panel";
import type { T } from "@/lib/ui-lang";

export default function InventoryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Inventory />
    </Suspense>
  );
}

function stockPill(i: StockView, t: T) {
  if (i.free === 0) return <Pill tone="red">{t("Finished")}</Pill>;
  if (i.free <= i.min_stock) return <Pill tone="amber">{t("Running low")}</Pill>;
  return <Pill tone="green">{t("Enough")}</Pill>;
}

function expiryPill(expiry: string | null, days: number | null, t: T) {
  if (days === null || !expiry) return <span className="text-muted">—</span>;
  const date = new Date(expiry).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  if (days <= 0) return <Pill tone="red">{t("Expired {date}", { date })}</Pill>;
  if (days <= 30) return <Pill tone="red">{date} · {t("{n} days", { n: days })}</Pill>;
  if (days <= NEAR_EXPIRY_DAYS) return <Pill tone="amber">{date} · {t("{n} days", { n: days })}</Pill>;
  if (days <= 180) return <Pill tone="blue">{date}</Pill>;
  return <span className="text-muted">{date}</span>;
}

async function Inventory() {
  await connection();
  const t = await getT();
  const items = stockView();
  const moves = db()
    .prepare(
      `SELECT m.*, i.name, c.name AS customer FROM stock_movements m
       JOIN items i ON i.id = m.item_id LEFT JOIN orders o ON o.id = m.order_id LEFT JOIN customers c ON c.phone = o.phone
       ORDER BY m.id DESC LIMIT 8`,
    )
    .all() as { id: number; name: string; change: number; kind: string; at: number; order_id: number | null; customer: string | null }[];
  const batchRows = expiryRows();
  const report = expiryReport(batchRows);
  const watch = report.flatMap((b) => b.rows);
  const mrp = new Map(batchRows.filter((r) => r.mrp).map((r) => [r.item_id, r.mrp!]));
  const batchCount = new Map<number, number>();
  for (const r of batchRows) batchCount.set(r.item_id, (batchCount.get(r.item_id) ?? 0) + 1);
  const expiring = atRisk(NEAR_EXPIRY_DAYS);
  const riskValue = expiring.reduce((s, r) => s + r.value, 0);
  const reorder = items.filter((i) => i.reorder > 0);
  const short = items.filter((i) => i.free <= i.min_stock);

  // Demand you could not meet in the last 30 days: products you do not stock, and quantities you were short of.
  const since = now() - 30 * 86_400_000;
  const notStocked = [
    ...(
      db()
        .prepare(`SELECT l.said, o.phone FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.status = 'unmatched' AND o.created_at >= ?`)
        .all(since) as { said: string; phone: string }[]
    )
      .reduce((m, r) => {
        // "Ascoril LS 20 strips" and "ascoril ls" are the same request
        const key = r.said.toLowerCase().replace(/\d+/g, " ").replace(/\b(strips?|boxes?|bottles?|tabs?|tablets?|pcs|units?|cases?|nos?)\b/g, " ").replace(/\s+/g, " ").trim();
        const cur = m.get(key) ?? { name: r.said.replace(/\s+\d+.*$/, ""), times: 0, retailers: new Set<string>() };
        cur.times++;
        cur.retailers.add(r.phone);
        return m.set(key, cur);
      }, new Map<string, { name: string; times: number; retailers: Set<string> }>())
      .values(),
  ].sort((a, b) => b.times - a.times).slice(0, 8);
  const shortOf = db()
    .prepare(
      `SELECT l.name, SUM(l.qty_requested - l.qty_confirmed) AS qty, SUM((l.qty_requested - l.qty_confirmed) * l.unit_price) AS value
       FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.created_at >= ? AND l.item_id IS NOT NULL AND l.status IN ('available','dropped') AND l.qty_confirmed < l.qty_requested
       GROUP BY l.item_id ORDER BY value DESC LIMIT 8`,
    )
    .all(since) as { name: string; qty: number; value: number }[];

  return (
    <>
      <Header title={t("Stock")} sub={t("What you have, what is running low, and what expires soon.")}>
        <a href="/demand" className={BTN_SECONDARY}><ShoppingCart className="size-4" aria-hidden /> {t("What to buy")}</a>
        <AddMedicine known={items.map((i) => ({ name: i.name, unit: i.unit, price: i.price, gst_rate: i.gst_rate, mfr: i.mfr, salt: i.salt, free: i.free, schedule: i.schedule }))} />
      </Header>
      <ImportPanel />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("Medicines")} value={items.length} icon={PillIcon} tone="blue" hint={t("{n} need a drug licence to sell", { n: items.filter((i) => i.rx || i.schedule).length })} />
        <Stat label={t("Running low")} value={short.length} icon={PackageMinus} tone={short.length ? "red" : "gray"} hint={t("{n} finished", { n: items.filter((i) => !i.free).length })} />
        <Stat label={t("Expiring soon")} value={inrShort(riskValue)} icon={CalendarX2} tone={expiring.some((r) => r.days <= 30) ? "red" : expiring.length ? "amber" : "gray"} hint={t("Worth of stock expired or expiring in 3 months")} />
        <Stat label={t("To buy")} value={reorder.length} icon={ShoppingCart} tone="blue" hint={t("Medicines to order so you do not run out this month")} />
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHead title={t("Your stock")} sub={t("How much you can sell now, when the next lot expires, and your price.")} />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>{["Medicine", "In stock", "Expires", "Price", ""].map((h, n) => <th key={n} className={TH}>{h && t(h)}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={ROW}>
                  <td className={`${TD} max-w-72`}>
                    <div className="font-medium">
                      {i.name}
                      {i.rx || i.schedule ? <span title={t("Needs the retailer's drug licence")} className="ml-1.5 rounded bg-danger-soft px-1 py-0.5 text-[10px] font-semibold text-danger">{t("Licence needed")}</span> : null}
                    </div>
                    {(i.salt || i.mfr) && <div className="truncate text-xs text-muted">{[i.mfr, i.salt].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className={TD}>
                    <span className="num text-base font-semibold">{i.free}</span> <span className="text-xs text-muted">{i.unit}</span>
                    {i.reserved > 0 && <div className="text-xs text-muted">{t("+{n} kept aside for orders", { n: i.reserved })}</div>}
                  </td>
                  <td className={TD} title={i.batch ? `${t("Batch")} ${i.batch}${(batchCount.get(i.id) ?? 0) > 1 ? ` · ${t("{n} batches", { n: batchCount.get(i.id)! })}` : ""}` : undefined}>
                    {expiryPill(i.expiry, i.expiryDays, t)}
                  </td>
                  <td className={TD} title={`GST ${i.gst_rate}% · HSN ${i.hsn}`}>
                    {inr(i.price)}
                    {mrp.get(i.id) ? <div className="text-xs text-muted">{t("MRP")} {inr(mrp.get(i.id)!)}</div> : null}
                  </td>
                  <td className={TD}>{stockPill(i, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && <Empty icon={PillIcon} title={t("No medicines yet")}>{t("Upload your stock list above to get started.")}</Empty>}
      </Card>

      <Card id="expiry" className="mb-6 overflow-hidden">
        <CardHead title={t("Expiring soon")} sub={t("Sell these first. Expired stock is never sent to retailers, and the oldest stock always goes out first.")} />
        <div className="grid grid-cols-1 gap-3 px-5 pb-4 sm:grid-cols-2 xl:grid-cols-4">
          {report.map((b) => (
            <div key={b.id} className={`rounded-xl border p-3 ${b.rows.length ? (b.tone === "red" ? "border-danger/40 bg-danger-soft" : b.tone === "amber" ? "border-warn/40 bg-warn-soft" : "border-line bg-primary-soft") : "border-line bg-subtle"}`}>
              <div className="text-xs font-medium text-muted">{t(b.label)}</div>
              <div className="mt-1 text-xl font-semibold">{b.rows.length ? inr(Math.round(b.value)) : t("None")}</div>
              <div className="text-xs text-muted">{b.rows.length ? t("{q} units", { q: b.qty }) : t("Nothing here")}</div>
              {b.rows.length > 0 && <div className="mt-2 text-xs">{t(b.advice)}</div>}
            </div>
          ))}
        </div>
        {watch.length > 0 ? (
          <div className="max-h-[28rem] overflow-auto border-t border-line">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface">
                <tr>{["Medicine", "Expires", "Quantity", "Rack", "Batch", "Worth"].map((h) => <th key={h} className={TH}>{t(h)}</th>)}</tr>
              </thead>
              <tbody>
                {watch.map((r) => (
                  <tr key={r.id} className={ROW}>
                    <td className={`${TD} font-medium`}>{r.name}{r.mfr && <div className="text-xs font-normal text-muted">{r.mfr}</div>}</td>
                    <td className={TD}>{expiryPill(r.expiry, r.days, t)}</td>
                    <td className={`${TD} num`}>{r.qty}</td>
                    <td className={`${TD} text-muted`}>{r.rack || "—"}</td>
                    <td className={`${TD} text-muted`}>{r.batch}</td>
                    <td className={`${TD} num`}>{inr(Math.round(r.value))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={CalendarX2} title={t("Nothing expires in the next 6 months")}>{batchRows.length ? null : t("Add expiry dates to your stock list to see this.")}</Empty>
        )}
      </Card>

      <Card className="mb-6 overflow-hidden">
        <div id="missed" className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-line">
          <div>
            <CardHead title={t("Asked for, but you do not sell it")} sub={t("Last 30 days. Worth adding if several retailers ask.")} />
            {notStocked.length ? (
              <ul className="divide-y divide-line">
                {notStocked.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="shrink-0 text-xs text-muted">{t(r.retailers.size === 1 ? "asked {x} times by {n} retailer" : "asked {x} times by {n} retailers", { x: r.times, n: r.retailers.size })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={SearchX} title={t("Nothing missed")}>{t("You had everything retailers asked for.")}</Empty>
            )}
          </div>
          <div>
            <CardHead title={t("Sales missed: not enough stock")} sub={t("Last 30 days: what retailers wanted beyond what you had.")} />
            {shortOf.length ? (
              <ul className="divide-y divide-line">
                {shortOf.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="num shrink-0 text-muted">{t("{n} short", { n: r.qty })} · {inr(Math.round(r.value))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={PackageMinus} title={t("No missed sales")}>{t("Every order was filled in full.")}</Empty>
            )}
          </div>
        </div>
      </Card>

      <More label={t("Stock history: what went in and out")}>
        <ul className="divide-y divide-line">
          {moves.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span> <span className="num text-muted">{m.change > 0 ? `+${m.change}` : m.change}</span>
                <span className="text-muted"> · {m.order_id ? `${t("Order #{n}", { n: m.order_id })} ${m.customer ?? ""}` : t("Stock list upload")} · {ago(m.at, t)}</span>
              </span>
              <Pill tone={MOVE[m.kind]?.tone ?? "gray"}>{t(MOVE[m.kind]?.label ?? m.kind)}</Pill>
            </li>
          ))}
        </ul>
        {!moves.length && <Empty icon={PackageMinus} title={t("Nothing yet")} />}
      </More>
    </>
  );
}

const MOVE: Record<string, { tone: Tone; label: string }> = {
  reserved: { tone: "amber", label: "Kept aside" },
  deducted: { tone: "green", label: "Taken from stock" },
  released: { tone: "gray", label: "Put back" },
  import: { tone: "blue", label: "Stock list upload" },
  added: { tone: "blue", label: "Added by you" },
  adjusted: { tone: "gray", label: "Stock count corrected" },
  undone: { tone: "gray", label: "Change undone" },
  returned: { tone: "blue", label: "Returned" },
};
