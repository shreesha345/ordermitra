import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, ShieldCheck, Smartphone, Truck } from "lucide-react";
import { creditNote, invoiceNo, payable, paymentGrade } from "@/lib/billing";
import { db, type AgentRun, type Customer, type Message } from "@/lib/db";
import { day, getLines, getOrder, orderBill } from "@/lib/orders";
import { LANG_NAMES, normLang } from "@/lib/i18n";
import { now, orderFlags, outstanding } from "@/lib/insights";
import { BTN_SECONDARY, Card, CardHead, Header, inr, More, PAYS, Pill, ROW, SOURCE, StatusPill, TD, TH, type Tone } from "@/components/ui";
import { AgentTrace } from "@/components/agent-trace";
import { ChatThread } from "@/components/chat";
import { OrderActions } from "@/components/order-actions";

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}

const LINE: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "gray", label: "Not checked yet" },
  available: { tone: "green", label: "Will send" },
  short: { tone: "amber", label: "Not enough, retailer asked" },
  out: { tone: "red", label: "Finished" },
  dropped: { tone: "red", label: "Retailer removed it" },
  not_needed: { tone: "gray", label: "Not needed" },
  unmatched: { tone: "gray", label: "We do not sell this" },
};

async function Detail({ params }: Pick<PageProps<"/orders/[id]">, "params">) {
  await connection();
  const t = await getT();
  const { id } = await params;
  const order = getOrder(Number(id));
  if (!order) notFound();
  const d = db();
  const lines = getLines(order.id);
  const c = d.prepare("SELECT * FROM customers WHERE phone = ?").get(order.phone) as Customer | undefined;
  const items = new Map(
    (d.prepare("SELECT id, stock, reserved, rx, schedule FROM items").all() as { id: number; stock: number; reserved: number; rx: number; schedule: string }[]).map((i) => [i.id, i]),
  );
  const flags = orderFlags(order);
  const due = outstanding(order.phone);
  const bill = orderBill(order);
  const price = payable(order);
  const note = creditNote(order);
  const grade = paymentGrade(order.phone);
  const runs = d.prepare("SELECT * FROM agent_runs WHERE order_id = ? ORDER BY id").all(order.id) as AgentRun[];
  const VERDICT: Record<string, { tone: Tone; label: string }> = {
    credit: { tone: "green", label: "Yes, on credit" },
    pay_first: { tone: "amber", label: "Must pay first" },
    review: { tone: "red", label: "Needs your OK" },
  };
  const verdict = VERDICT[order.credit_verdict];
  const translated = !!order.understood && order.understood.trim().toLowerCase() !== (order.transcript ?? "").trim().toLowerCase();
  const gst = Math.round((bill.total - bill.subtotal) * 100) / 100;
  const pays = PAYS[grade.grade];
  const MOVE: Record<string, { tone: Tone; label: string }> = {
    reserved: { tone: "amber", label: "Kept aside" },
    deducted: { tone: "green", label: "Taken from stock" },
    released: { tone: "gray", label: "Put back" },
  };
  // The conversation for this order: from just before it arrived until the retailer's next order.
  const next = d.prepare("SELECT created_at FROM orders WHERE phone = ? AND id > ? ORDER BY id LIMIT 1").get(order.phone, order.id) as { created_at: number } | undefined;
  const chat = d
    .prepare("SELECT * FROM messages WHERE phone = ? AND at >= ? AND at < ? ORDER BY id LIMIT 60")
    .all(order.phone, order.created_at - 5 * 60_000, next ? next.created_at - 5 * 60_000 : now() + 60_000) as Message[];
  const moves = d
    .prepare("SELECT m.*, i.name FROM stock_movements m JOIN items i ON i.id = m.item_id WHERE m.order_id = ? ORDER BY m.id")
    .all(order.id) as { id: number; name: string; change: number; kind: string; at: number }[];

  return (
    <>
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t("Orders")}
      </Link>
      <Header
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("Order #{n}", { n: order.id })} <StatusPill status={order.status} t={t} />
            {order.dispatched_at && <Pill tone="blue"><Truck className="size-3" aria-hidden /> {t("Out for delivery {date}", { date: day(order.dispatched_at) })}</Pill>}
          </span>
        }
        sub={`${c?.name ?? "+" + order.phone} · ${t("{source} in {language}", { source: t(SOURCE[order.source] ?? order.source), language: LANG_NAMES[normLang(order.language)] })} · ${new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
      >
        {order.view_token && (
          <a href={`/o/${order.view_token}`} target="_blank" className={BTN_SECONDARY}>
            <Smartphone className="size-4" aria-hidden /> {t("What the retailer sees")}
          </a>
        )}
        <OrderActions id={order.id} status={order.status} dispatched={!!order.dispatched_at} payNow={inr(price.amount)} />
        {order.total > 0 && (
          <a href={`/api/orders/${order.id}/invoice`} target="_blank" className={BTN_SECONDARY}>
            <Download className="size-4" aria-hidden /> {t("Download bill")}
          </a>
        )}
      </Header>

      {flags.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {flags.map((f) => (
            <div key={f.text} role="alert" className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${f.tone === "red" ? "border-danger/30 bg-danger-soft text-danger" : "border-warn/30 bg-warn-soft text-warn"}`}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {f.text}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHead title={t("What the retailer sent")} />
            <div className={`grid gap-3 px-5 pb-5 text-sm ${translated ? "sm:grid-cols-2" : ""}`}>
              <div className="rounded-lg bg-subtle p-3">
                <div className="mb-1 text-xs font-medium text-muted">{t("In their words")}</div>
                {order.transcript || "—"}
              </div>
              {translated && (
                <div className="rounded-lg bg-subtle p-3">
                  <div className="mb-1 text-xs font-medium text-muted">{t("In English")}</div>
                  {order.understood}
                </div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHead title={t("Items")} sub={t("What they asked for, and what we are sending")} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>{["They asked for", "Our item", "Asked", "Sending", "In stock now", "Price", ""].map((h, i) => <th key={i} className={TH}>{h && t(h)}</th>)}</tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const s = l.item_id ? items.get(l.item_id) : undefined;
                    const r = LINE[l.status];
                    return (
                      <tr key={l.id} className={ROW}>
                        <td className={`${TD} text-muted`}>“{l.said}”{l.unit_note && <div className="text-xs">{t("wrote {x}", { x: l.unit_note.replace(/^\?/, "") })}</div>}</td>
                        <td className={TD}>
                          {l.status === "unmatched" ? "—" : l.name}
                          {s?.rx || s?.schedule ? <span title={t("Needs the retailer's drug licence")} className="ml-1.5 rounded bg-danger-soft px-1 py-0.5 text-[10px] font-semibold text-danger">{t("Licence needed")}</span> : null}
                        </td>
                        <td className={TD}>{l.qty_requested}</td>
                        <td className={TD}>{l.qty_confirmed || "—"}</td>
                        <td className={`${TD} text-muted`}>{s ? Math.max(0, s.stock - s.reserved) : "—"}</td>
                        <td className={TD}>{l.item_id ? inr(l.unit_price) : "—"}</td>
                        <td className={TD}><Pill tone={r.tone}>{t(r.label)}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead title={t("WhatsApp conversation")} sub={t("Everything the retailer and the assistant said about this order")} />
            <div className="mx-5 mb-5 max-h-[480px] overflow-y-auto rounded-lg bg-wa-chat p-4">
              {chat.length ? <ChatThread messages={chat} /> : <p className="text-center text-sm text-muted">{t("No messages recorded.")}</p>}
            </div>
          </Card>

          {runs.length > 0 && (
            <More label={t("How the assistant handled this order, step by step")}>
              <div className="flex flex-col gap-6 px-5 py-5 pl-9">
                {runs.map((r) => <AgentTrace key={r.id} run={r} t={t} />)}
              </div>
            </More>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHead title={t("Bill {inv}", { inv: invoiceNo(order) })} />
            <div className="flex flex-col gap-2 px-5 pb-5 text-sm">
              {bill.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="min-w-0 text-muted">{l.name} × {l.qty} <span className="text-faint">@ {inr(l.rate)}</span></span>
                  <span className="num shrink-0">{inr(l.taxable)}</span>
                </div>
              ))}
              {!bill.lines.length && <p className="text-muted">{t("The bill is made once the retailer confirms and stock is checked.")}</p>}
              <div className="my-1 border-t border-line" />
              <div className="flex justify-between"><span className="text-muted">{t("Before GST")}</span><span className="num">{inr(bill.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t("GST")}</span><span className="num">{inr(gst)}</span></div>
              <div className="mt-1 flex justify-between text-base font-semibold"><span>{t("Total")}</span><span className="num">{inr(bill.total)}</span></div>
              {bill.slabs.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-faint hover:text-muted">{t("GST breakdown")}</summary>
                <div className="mt-2 flex flex-col gap-1.5">
              {bill.slabs.map((x) =>
                bill.igst ? (
                  <div key={x.gstRate} className="flex justify-between"><span className="text-muted">IGST {x.gstRate}%</span><span className="num">{inr(x.igst)}</span></div>
                ) : (
                  <div key={x.gstRate} className="flex flex-col gap-2">
                    <div className="flex justify-between"><span className="text-muted">CGST {x.gstRate / 2}%</span><span className="num">{inr(x.cgst)}</span></div>
                    <div className="flex justify-between"><span className="text-muted">SGST {x.gstRate / 2}%</span><span className="num">{inr(x.sgst)}</span></div>
                  </div>
                ),
              )}
                </div>
              </details>
              )}

              {order.status === "paid" && (
                <div className="mt-3 flex flex-col gap-1 rounded-lg bg-success-soft p-3 text-success">
                  <div className="flex justify-between font-medium"><span>{t("Paid")}{order.paid_at ? ` ${day(order.paid_at)}` : ""}</span><span className="num">{inr(order.paid_amount || order.total)}</span></div>
                  {order.discount > 0 && (
                    <div className="text-xs">
                      <span title={`CN-${invoiceNo(order).replace(/^\w+\//, "")} · ${inr(note.taxable)} + ${inr(note.gst)} GST`}>{t("Paid early, so got {amount} off", { amount: inr(note.total) })}</span>
                    </div>
                  )}
                </div>
              )}
              {order.billed_at && ["awaiting_payment", "confirmed_cod"].includes(order.status) && (
                <div className={`mt-3 flex flex-col gap-1 rounded-lg p-3 ${price.overdueDays ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary"}`}>
                  <div className="flex justify-between font-medium"><span>{t("If paid today")}</span><span className="num">{inr(price.amount)}</span></div>
                  <div className="text-xs">
                    {price.discount ? `${t("{pct}% off ({amount}) until {date}.", { pct: price.pct, amount: inr(price.discount), date: day(price.until!) })} ` : ""}
                    {price.overdueDays ? t("{n} days overdue (was due {date}).", { n: price.overdueDays, date: day(price.dueAt) }) : t("Full amount due by {date}.", { date: day(price.dueAt) })}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {verdict && (
            <Card>
              <CardHead title={t("Can they take it on credit?")}><Pill tone={verdict.tone}>{t(verdict.label)}</Pill></CardHead>
              <div className="flex flex-col gap-1.5 px-5 pb-5 text-sm">
                {(JSON.parse(order.credit_reasons) as string[]).map((r) => <p key={r} className="text-muted">{r}</p>)}
                {order.credit_verdict === "credit" && <p className="text-muted">{t("No late bills, under their credit limit, and their licence is fine.")}</p>}
                <p className="text-xs text-faint">{t(pays.label)} · {grade.hint}</p>
              </div>
            </Card>
          )}

          {c && (
            <Card>
              <CardHead title={t("Retailer")}>
                <Link href={`/customers/${c.phone}`} className="text-xs font-medium text-primary">{t("Profile")}</Link>
              </CardHead>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 pb-5 text-sm">
                <dt className="text-muted">{t("Name")}</dt><dd className="font-medium">{c.name}</dd>
                <dt className="text-muted">{t("Phone")}</dt><dd>+{c.phone}</dd>
                {c.city && <><dt className="text-muted">{t("City")}</dt><dd>{c.city}</dd></>}
                <dt className="text-muted">{t("Drug licence")}</dt>
                <dd>{c.drug_licence ? <span className="inline-flex items-center gap-1"><ShieldCheck className="size-4 text-success" aria-hidden />{c.drug_licence}</span> : <Pill tone="red">{t("Not on file")}</Pill>}</dd>
                <dt className="text-muted">{t("Owes you")}</dt>
                <dd>
                  <span className="num">{inr(due)}</span> <span className="text-muted">{t("of {amount}", { amount: inr(c.credit_limit) })}</span>
                  <div className="mt-1.5 h-1.5 rounded-full bg-subtle">
                    <div className={`h-full rounded-full ${due > c.credit_limit ? "bg-danger" : due > c.credit_limit * 0.8 ? "bg-warn" : "bg-success"}`} style={{ width: `${Math.min(100, (due / Math.max(1, c.credit_limit)) * 100)}%` }} />
                  </div>
                </dd>
              </dl>
            </Card>
          )}

          {moves.length > 0 && (
            <More label={t("Stock used for this order")}>
              <p className="px-5 pt-3 text-xs text-muted">{t("Kept aside when the bill is sent, taken from stock when it is paid or delivered.")}</p>
              <ul className="flex flex-col gap-2 px-5 py-3 text-sm">
                {moves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.name} <span className="num text-muted">{m.change > 0 ? `+${m.change}` : m.change}</span></span>
                    <Pill tone={MOVE[m.kind]?.tone ?? "gray"}>{t(MOVE[m.kind]?.label ?? m.kind)}</Pill>
                  </li>
                ))}
              </ul>
            </More>
          )}
        </div>
      </div>
    </>
  );
}
