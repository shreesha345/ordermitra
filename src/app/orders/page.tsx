import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { AlertTriangle, Download, Inbox, Search } from "lucide-react";
import { db, type Order } from "@/lib/db";
import { attention } from "@/lib/insights";
import { ago, Card, Empty, Header, inr, INPUT, ROW, SOURCE, StatusPill, TD, TH } from "@/components/ui";

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

const VIEWS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs you" },
  { id: "open", label: "Waiting for retailer" },
  { id: "unpaid", label: "Not paid" },
  { id: "paid", label: "Paid" },
  { id: "cancelled", label: "Cancelled" },
] as const;

const WHERE: Record<string, string> = {
  open: "o.status IN ('awaiting_approval','awaiting_customer','awaiting_confirm','awaiting_review')",
  unpaid: "o.status IN ('awaiting_payment','confirmed_cod')",
  paid: "o.status = 'paid'",
  cancelled: "o.status = 'cancelled'",
};

type Row = Order & { customer: string | null; city: string | null; items: number };

async function Orders({ searchParams }: Pick<PageProps<"/orders">, "searchParams">) {
  await connection();
  const t = await getT();
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.id === sp.view) ? (sp.view as string) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const flagged = new Map(attention().map((a) => [a.id, a.reasons]));
  const where = [WHERE[view] ?? "1=1"];
  const args: string[] = [];
  if (view === "attention") where.push(`o.id IN (${[...flagged.keys()].join(",") || "0"})`);
  if (q) {
    where.push("(c.name LIKE ? OR o.phone LIKE ? OR CAST(o.id AS TEXT) = ?)");
    args.push(`%${q}%`, `%${q.replace(/\D/g, "") || q}%`, q.replace(/^#/, ""));
  }
  const rows = db()
    .prepare(
      `SELECT o.*, c.name AS customer, c.city,
        (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id AND l.status NOT IN ('not_needed','unmatched','dropped')) AS items
       FROM orders o LEFT JOIN customers c ON c.phone = o.phone WHERE ${where.join(" AND ")} ORDER BY o.id DESC LIMIT 200`,
    )
    .all(...args) as Row[];

  const href = (v: string) => `/orders?${new URLSearchParams({ ...(v !== "all" && { view: v }), ...(q && { q }) })}`;

  return (
    <>
      <Header title={t("Orders")} sub={t("Every order retailers sent you on WhatsApp. Open one to see the items, the bill and the chat.")} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("Filter orders")} className="flex gap-1 overflow-x-auto rounded-lg bg-subtle p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={href(v.id)}
              aria-current={view === v.id ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                view === v.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {t(v.label)}
              {v.id === "attention" && flagged.size > 0 && <span className="rounded-full bg-danger px-1.5 text-[11px] text-white">{flagged.size}</span>}
            </Link>
          ))}
        </nav>
        <form className="relative w-full sm:w-72" role="search">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input name="q" defaultValue={q} placeholder={t("Search by shop name, phone or order number")} aria-label={t("Search orders")} className={`${INPUT} pl-9`} />
        </form>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {["Order", "Retailer", "Items", "Total", "Status", ""].map((h, i) => (
                  <th key={i} className={TH}>{h && t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flags = flagged.get(r.id);
                return (
                  <tr key={r.id} className={ROW}>
                    <td className={TD}>
                      <Link href={`/orders/${r.id}`} className="font-medium text-primary hover:underline">#{r.id}</Link>
                      <div className="text-xs text-muted">{ago(r.created_at, t)} · {t(SOURCE[r.source] ?? r.source)}</div>
                    </td>
                    <td className={TD}>
                      <div className="flex items-center gap-1.5 font-medium">
                        {r.customer ?? `+${r.phone}`}
                        {flags && (
                          <span title={flags.map((f) => t(f.text)).join("\n")}>
                            <AlertTriangle className={`size-3.5 ${flags.some((f) => f.tone === "red") ? "text-danger" : "text-warn"}`} aria-label={flags.map((f) => f.text).join(". ")} />
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">{r.city || `+${r.phone}`}</div>
                    </td>
                    <td className={`${TD} text-muted`}>{r.items}</td>
                    <td className={`${TD} font-medium`}>{r.total ? inr(r.total) : "—"}</td>
                    <td className={TD}><StatusPill status={r.status} t={t} /></td>
                    <td className={`${TD} text-right`}>
                      {r.total > 0 && (
                        <a href={`/api/orders/${r.id}/invoice`} target="_blank" className="inline-flex rounded-md p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label={t("Invoice for order {n}", { n: r.id })} title={t("Download bill")}>
                          <Download className="size-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty icon={Inbox} title={q || view !== "all" ? t("No matching orders") : t("No orders yet")}>
            {q || view !== "all" ? t("Try another tab or search.") : t("They appear here when a retailer sends an order on WhatsApp.")}
          </Empty>
        )}
      </Card>
    </>
  );
}
