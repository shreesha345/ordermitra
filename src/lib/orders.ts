import { sellingUnit, toSellingQty } from "./units";
import { countStates, lineViews, LINK_OVER_CHARS, LINK_OVER_LINES, orderLink, qtyText, viewToken, wroteText, type LineView } from "./order-view";
import { consume } from "./batches";
import { db, tx, type Customer, type Item, type Line, type Order } from "./db";
import { inr, normLang, t, type Lang } from "./i18n";
import { storeName } from "./brand";
import { maybeAskGstin } from "./gst-collect";
import { computeBill, creditDays, creditDecision, invoiceNo, isInterState, nextInvoiceNo, licenceProblem, payable, round2, scheduledOn, tiers, type Verdict } from "./billing";
import { regularItems } from "./insights";
import { substitutes, type OrderItem } from "./match";
import { createPaymentLink, razorpayLive, watchPaymentLink } from "./razorpay";
import { step, traceOrder } from "./trace";
import { nativePaymentsOn, sendDocument, sendPaymentCard, sendText } from "./whatsapp";

const now = () => Date.now();
const free = (i: Pick<Item, "stock" | "reserved">) => Math.max(0, i.stock - i.reserved);
export const day = (at: number) => new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const getOrder = (id: number) => db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as Order | undefined;
export const getLines = (id: number) =>
  db().prepare("SELECT * FROM order_lines WHERE order_id = ? ORDER BY id").all(id) as Line[];
const getItem = (id: number) => db().prepare("SELECT * FROM items WHERE id = ?").get(id) as Item;
const getCustomer = (phone: string) => db().prepare("SELECT * FROM customers WHERE phone = ?").get(phone) as Customer | undefined;

function setStatus(id: number, status: string) {
  db().prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
}

/** The bill as it stands: confirmed quantities, GST per line, CGST+SGST or IGST. */
export const orderBill = (o: Pick<Order, "id" | "igst">) => computeBill(getLines(o.id), o.igst === 1);

function saveTotals(orderId: number) {
  const b = orderBill(getOrder(orderId)!);
  db().prepare("UPDATE orders SET subtotal = ?, gst = ?, total = ? WHERE id = ?").run(b.subtotal, b.gst, b.total, orderId);
  return b;
}

/** "• Dolo 650 (15 tabs) × 7 strip (you wrote: 100 tablet)" */
const unitBullet = (l: Line, lang: Lang) => {
  const item = l.item_id ? (db().prepare("SELECT name, unit FROM items WHERE id = ?").get(l.item_id) as Pick<Item, "name" | "unit">) : null;
  const unit = item ? sellingUnit(item) : null;
  const wrote = wroteText(lang, l.unit_note);
  const note = l.unit_note.startsWith("?") ? t(lang, "unitCheck", { x: wrote }) : l.unit_note ? t(lang, "youWrote", { x: wrote }) : "";
  return `• ${l.name} × ${qtyText(lang, l.qty_requested, unit)}${note ? ` (${note})` : ""}`;
};

// ---------------------------------------------------------------------------
// 1. What the retailer asked for -> confirmation card
// ---------------------------------------------------------------------------

export type NewOrder = { transcript: string; translation: string; items: OrderItem[] };

/** Creates the order from matched items and sends the confirmation card. */
export async function startOrder(phone: string, lang: Lang, u: NewOrder, source: string) {
  const d = db();
  const c = getCustomer(phone);
  const orderId = tx(() => {
    const r = d
      .prepare(
        "INSERT INTO orders (phone, language, status, transcript, understood, source, igst, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(phone, lang, "awaiting_approval", u.transcript, u.translation, source === "audio" ? "voice" : source, isInterState(c?.gstin ?? "") ? 1 : 0, now(), now());
    const id = Number(r.lastInsertRowid);
    for (const it of u.items) {
      const item = it.match ? (d.prepare("SELECT * FROM items WHERE name = ?").get(it.match) as Item | undefined) : undefined;
      // "2 boxes" or "100 tablets" -> strips, when the pack size says how
      const conv = item ? toSellingQty(item, it.qty, it.unit ?? null) : null;
      d.prepare(
        "INSERT INTO order_lines (order_id, item_id, said, name, qty_requested, unit_price, gst_rate, hsn, unit_note, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(id, item?.id ?? null, it.said, item?.name ?? it.said, conv?.qty ?? it.qty, item?.price ?? 0, item?.gst_rate ?? 5, item?.hsn ?? "", conv?.note ? `${conv.unclear ? "?" : ""}${conv.note}` : "", !item ? "unmatched" : it.needed ? "pending" : "not_needed");
    }
    return id;
  });
  traceOrder(orderId);

  const lines = getLines(orderId);
  const rows = lines.map((l) => {
    if (l.status === "not_needed") return `• ${l.name} — ${t(lang, "notNeeded")}`;
    if (l.status === "unmatched") return `• ${l.said} — ${t(lang, "notFound")}`;
    return unitBullet(l, lang);
  });
  const est = computeBill(lines.filter((l) => l.status === "pending").map((l) => ({ ...l, qty_confirmed: l.qty_requested })), isInterState(c?.gstin ?? ""));
  step("order", `Created order #${orderId}`, `${lines.filter((l) => l.status === "pending").length} items, about ${inr(est.total)} incl. GST`, "good");
  const body = [
    `*${t(lang, "confirmTitle")}* (#${orderId})`,
    u.transcript && `${t(lang, "youSaid")}\n"${u.transcript.slice(0, 400)}"`,
    `${t(lang, "weUnderstood")}\n${rows.join("\n")}`,
    `*${t(lang, "estTotal")}: ${inr(est.total)}* (incl. GST)`,
  ].filter(Boolean).join("\n\n");
  const big = rows.length > LINK_OVER_LINES || body.length > LINK_OVER_CHARS;
  if (big) step("order", "Sent the full list as a link", `${rows.length} lines are too many for one WhatsApp message`);
  await sendText(phone, big ? bigCard(orderId, lang, `*${t(lang, "confirmTitle")}* (#${orderId})`, est.total) : body, [
    { id: `approve:${orderId}`, title: t(lang, "approve") },
    { id: `edit:${orderId}`, title: t(lang, "edit") },
  ]);
  await maybeAskGstin(c, lang);
  // Scheduled medicines need a licence on file; ask for it now rather than at billing.
  const scheduled = scheduledOn(orderId);
  const problem = licenceProblem(c, scheduled);
  if (problem && (!c?.drug_licence || c.licence_status === "rejected" || /expired/.test(problem))) {
    step("licence", "Asked for the drug licence", problem, "warn");
    await sendText(phone, t(lang, "needLicence", { name: scheduled[0].name }));
  }
  return { orderId, unmatched: lines.filter((l) => l.status === "unmatched").map((l) => l.said) };
}

/** Up to `max` lines, then "…and N more". */
function some<T>(lang: Lang, list: T[], show: (x: T) => string, max = 5) {
  return [...list.slice(0, max).map(show), ...(list.length > max ? [t(lang, "andMore", { n: list.length - max })] : [])].join("\n");
}

/** "• Dolo 650: you asked 50 strip, we have 30 strip" */
const shortLine = (lang: Lang, v: LineView) =>
  v.state === "out"
    ? `• ${v.line.name} — ${t(lang, "noStock")}`
    : `• ${t(lang, "askedHave", { name: v.line.name, want: qtyText(lang, v.line.qty_requested, v.unit), have: qtyText(lang, v.have, v.unit) })}`;

function stateSummary(lang: Lang, views: LineView[]) {
  const n = countStates(views);
  return [
    n.available && t(lang, "sumAvailable", { n: n.available }),
    n.short && t(lang, "sumShort", { n: n.short }),
    n.out && t(lang, "sumOut", { n: n.out }),
    n.missing && t(lang, "sumMissing", { n: n.missing }),
  ].filter(Boolean).join("\n");
}

/**
 * The confirmation for a list too long for one message: counts, what is missing or short by name (as of the
 * stock right now), and a link to every line with its quantity and unit.
 */
function bigCard(orderId: number, lang: Lang, title: string, total: number) {
  const views = lineViews(orderId);
  const wanted = views.filter((v) => v.state !== "not_needed" && v.state !== "removed");
  const missing = views.filter((v) => v.state === "missing");
  const short = views.filter((v) => v.state === "short" || v.state === "out");
  return [
    title,
    `${t(lang, "bigOrder", { n: wanted.length })}\n${orderLink(orderId)}`,
    stateSummary(lang, views),
    missing.length && t(lang, "notInList", { items: some(lang, missing, (v) => v.line.said.slice(0, 30)).replaceAll("\n", ", ") }),
    short.length && some(lang, short, (v) => shortLine(lang, v)),
    `*${t(lang, "estTotal")}: ${inr(total)}* (incl. GST)`,
  ].filter(Boolean).join("\n\n");
}

/** Many items short or out of stock: one message with a choice for all of them, instead of one message each. */
async function stockIssuesCard(orderId: number, lang: Lang, phone: string) {
  const views = lineViews(orderId);
  const issues = views.filter((v) => v.state === "short" || v.state === "out");
  const body = [
    `*${t(lang, "stockChecked")}* (#${orderId})`,
    stateSummary(lang, views),
    some(lang, issues, (v) => shortLine(lang, v), 8),
    `${t(lang, "stockIssues")}\n${orderLink(orderId)}`,
  ].join("\n\n");
  await sendText(phone, body, [
    { id: `keepall:${orderId}`, title: t(lang, "keepAll") },
    ...(issues.some((v) => v.sub) ? [{ id: `suball:${orderId}`, title: t(lang, "subAll") }] : []),
    { id: `edit:${orderId}`, title: t(lang, "edit") },
  ]);
}

/** The retailer's last billed order, for "same as last time". */
export function lastOrderItems(phone: string) {
  const o = db()
    .prepare("SELECT * FROM orders WHERE phone = ? AND status IN ('paid','confirmed_cod','awaiting_payment') ORDER BY id DESC LIMIT 1")
    .get(phone) as Order | undefined;
  if (!o) return null;
  return { order: o, items: getLines(o.id).filter((l) => l.qty_confirmed > 0).map((l) => ({ name: l.name, qty: l.qty_confirmed })) };
}

// ---------------------------------------------------------------------------
// 2. Confirmed -> check stock -> bill, or ask the retailer item by item
// ---------------------------------------------------------------------------

async function approve(orderId: number): Promise<void> {
  const order = getOrder(orderId)!;
  const lang = normLang(order.language);
  const d = db();
  const problems: Line[] = [];
  const okLines: Line[] = [];
  tx(() => {
    for (const l of getLines(orderId).filter((x) => ["pending", "available", "short", "out"].includes(x.status))) {
      const item = getItem(l.item_id!);
      const have = free(item);
      const status = have >= l.qty_requested ? "available" : have > 0 ? "short" : "out";
      const qty = status === "available" ? l.qty_requested : 0;
      // Rate, GST, HSN, batch and expiry are fixed on the line now, as they will print on the invoice.
      d.prepare("UPDATE order_lines SET status = ?, qty_confirmed = ?, unit_price = ?, gst_rate = ?, hsn = ?, batch = ?, expiry = ? WHERE id = ?").run(
        status, qty, item.price, item.gst_rate, item.hsn, item.batch, item.expiry, l.id,
      );
      (status === "available" ? okLines : problems).push({ ...l, status, qty_confirmed: qty });
    }
  });
  step(
    "stock",
    `Checked stock: ${okLines.length} of ${okLines.length + problems.length} items available`,
    problems.map((l) => `${l.name}: ${l.status === "short" ? `only ${free(getItem(l.item_id!))} of ${l.qty_requested}` : "out of stock"}`).join(" · ") || undefined,
    problems.length ? "warn" : "good",
  );

  if (!problems.length) return bill(orderId);

  setStatus(orderId, "awaiting_customer");
  if (problems.length > 3 || okLines.length + problems.length > LINK_OVER_LINES) return stockIssuesCard(orderId, lang, order.phone);
  if (okLines.length) {
    const head = [`*${t(lang, "stockChecked")}*`, ...okLines.map((l) => `• ${l.name} × ${l.qty_requested} — ${t(lang, "available")}`)];
    await sendText(order.phone, head.join("\n"));
  }
  for (const l of problems) {
    const item = getItem(l.item_id!);
    const have = free(item);
    // Same composition and strength, in stock: a pharmacist may supply it instead.
    const sub = substitutes(item)[0];
    if (sub) step("substitute", `Found a substitute for ${l.name}: ${sub.name}`, `Same composition (${item.salt}), ${free(sub)} in stock`, "good");
    const offer = sub ? `\n${t(lang, "subOffer", { sub: sub.name, salt: item.salt, n: free(sub) })}` : "";
    const subBtn = sub ? [{ id: `sub:${orderId}:${l.id}:${sub.id}`, title: t(lang, "takeSub") }] : [];
    if (l.status === "short") {
      await sendText(order.phone, t(lang, "onlyHave", { name: l.name, have, want: l.qty_requested }) + offer, [
        { id: `keep:${orderId}:${l.id}`, title: t(lang, "addToCart", { n: have }) },
        ...subBtn,
        { id: `drop:${orderId}:${l.id}`, title: t(lang, "dropItem") },
      ]);
    } else {
      await sendText(order.phone, t(lang, "outOfStock", { name: l.name }) + offer, [...subBtn, { id: `drop:${orderId}:${l.id}`, title: t(lang, "dropItem") }]);
    }
  }
}

async function decide(orderId: number, lineId: number, choice: "keep" | "drop" | "sub", subId?: number) {
  const order = getOrder(orderId)!;
  const lang = normLang(order.language);
  const line = getLines(orderId).find((l) => l.id === lineId);
  if (!line || !["short", "out"].includes(line.status)) return sendText(order.phone, t(lang, "stale"));
  const d = db();
  if (choice === "sub") {
    const orig = getItem(line.item_id!);
    const sub = subId ? getItem(subId) : undefined;
    // Re-check: same composition, and still in stock now
    if (!sub || !orig.salt || sub.salt.trim().toLowerCase() !== orig.salt.trim().toLowerCase() || free(sub) <= 0) return sendText(order.phone, t(lang, "stale"));
    const qty = Math.min(free(sub), line.qty_requested);
    d.prepare("UPDATE order_lines SET item_id = ?, name = ?, unit_price = ?, gst_rate = ?, hsn = ?, batch = ?, expiry = ?, status = 'available', qty_confirmed = ? WHERE id = ?").run(
      sub.id, sub.name, sub.price, sub.gst_rate, sub.hsn, sub.batch, sub.expiry, qty, lineId,
    );
    step("substitute", `Retailer took ${sub.name} instead of ${line.name}`, `${qty} ${sub.unit}s`, "good");
  } else {
    const have = line.item_id ? Math.min(free(getItem(line.item_id)), line.qty_requested) : 0;
    const keep = choice === "keep" && have > 0;
    d.prepare("UPDATE order_lines SET status = ?, qty_confirmed = ? WHERE id = ?").run(keep ? "available" : "dropped", keep ? have : 0, lineId);
  }

  if (getLines(orderId).some((l) => ["short", "out"].includes(l.status))) return; // more items waiting on the retailer
  return finishChoices(orderId);
}

/** "Keep what's there" or "Take substitutes" for every short and out-of-stock item at once. */
async function decideAll(orderId: number, withSubs: boolean) {
  const d = db();
  const used = new Map<number, number>(); // stock already promised to an earlier line in this order
  const left = (i: Item) => free(i) - (used.get(i.id) ?? 0);
  const changes: string[] = [];
  tx(() => {
    for (const l of getLines(orderId).filter((x) => ["short", "out"].includes(x.status))) {
      const item = getItem(l.item_id!);
      const have = Math.min(left(item), l.qty_requested);
      // A substitute replaces the line when it covers more than we have of the original
      const sub = withSubs ? substitutes(item).map((c) => getItem(c.id)).find((c) => left(c) > have) : undefined;
      if (sub) {
        const qty = Math.min(left(sub), l.qty_requested);
        used.set(sub.id, (used.get(sub.id) ?? 0) + qty);
        d.prepare("UPDATE order_lines SET item_id = ?, name = ?, unit_price = ?, gst_rate = ?, hsn = ?, batch = ?, expiry = ?, status = 'available', qty_confirmed = ? WHERE id = ?").run(
          sub.id, sub.name, sub.price, sub.gst_rate, sub.hsn, sub.batch, sub.expiry, qty, l.id,
        );
        changes.push(`${l.name} → ${sub.name} × ${qty}`);
      } else {
        used.set(item.id, (used.get(item.id) ?? 0) + Math.max(0, have));
        d.prepare("UPDATE order_lines SET status = ?, qty_confirmed = ? WHERE id = ?").run(have > 0 ? "available" : "dropped", Math.max(0, have), l.id);
        changes.push(have > 0 ? `${l.name} × ${have} of ${l.qty_requested}` : `${l.name} dropped`);
      }
    }
  });
  step("order", withSubs ? "Retailer took substitutes for every short item" : "Retailer kept what is in stock for every short item", changes.join(" · ") || undefined);
  return finishChoices(orderId);
}

async function finishChoices(orderId: number) {
  const order = getOrder(orderId)!;
  const lang = normLang(order.language);
  const kept = getLines(orderId).filter((l) => l.qty_confirmed > 0);
  if (!kept.length) {
    setStatus(orderId, "cancelled");
    return sendText(order.phone, t(lang, "allDropped"));
  }
  const tot = saveTotals(orderId);
  setStatus(orderId, "awaiting_confirm");
  const rows = getLines(orderId)
    .filter((l) => !["not_needed", "unmatched"].includes(l.status))
    .map((l) =>
      l.status === "dropped"
        ? `• ${l.name} × ${l.qty_requested} — ${t(lang, "dropped")}`
        : `• ${l.name} × ${l.qty_confirmed}${l.qty_confirmed < l.qty_requested ? ` (${l.qty_confirmed}/${l.qty_requested})` : ""} — ${inr(round2(l.qty_confirmed * l.unit_price))}`,
    );
  const updated = [`*${t(lang, "updatedOrder")}* (#${orderId})`, rows.join("\n"), `*${t(lang, "total")}: ${inr(tot.total)}* (incl. GST)`].join("\n\n");
  const big = rows.length > LINK_OVER_LINES || updated.length > LINK_OVER_CHARS;
  const short = [
    `*${t(lang, "updatedOrder")}* (#${orderId})`,
    `${t(lang, "fullList")}: ${orderLink(orderId)}`,
    stateSummary(lang, lineViews(orderId)),
    `*${t(lang, "total")}: ${inr(tot.total)}* (incl. GST)`,
  ].join("\n\n");
  await sendText(order.phone, big ? short : updated, [
    { id: `confirm:${orderId}`, title: t(lang, "confirmUpdated") },
    { id: `edit:${orderId}`, title: t(lang, "edit") },
  ]);
}

// ---------------------------------------------------------------------------
// 3. Credit decision, then bill: reserve stock, send the invoice and the payment terms
// ---------------------------------------------------------------------------

const VERDICT_LABEL: Record<Verdict, string> = {
  credit: "Credit check passed: can take this on credit",
  pay_first: "Credit check: must pay before dispatch",
  review: "Credit check: sent to your team to approve or deny",
};

/** `override` is the team's decision on an order that was held for review. */
async function bill(orderId: number, override?: Exclude<Verdict, "review">): Promise<void> {
  const order = getOrder(orderId)!;
  const lang = normLang(order.language);
  const d = db();
  const est = orderBill(order);
  const decision = override
    ? { verdict: override, reasons: [override === "credit" ? "Approved on credit by your team" : "Approved by your team, to be paid before dispatch"] }
    : creditDecision(order.phone, est.total, scheduledOn(orderId), orderId);
  step("credit", VERDICT_LABEL[decision.verdict], decision.reasons.join(" · ") || undefined, decision.verdict === "credit" ? "good" : decision.verdict === "pay_first" ? "warn" : "bad");

  if (decision.verdict === "review") {
    d.prepare("UPDATE orders SET subtotal = ?, gst = ?, total = ?, credit_verdict = ?, credit_reasons = ? WHERE id = ?").run(
      est.subtotal, est.gst, est.total, "review", JSON.stringify(decision.reasons), orderId,
    );
    setStatus(orderId, "awaiting_review");
    return void (await sendText(order.phone, t(lang, "underReview", { id: orderId })));
  }

  const raced = tx(() => {
    const lines = getLines(orderId).filter((l) => l.qty_confirmed > 0);
    // stock may have changed since the check; if so, go back through the shortage flow
    if (lines.some((l) => free(getItem(l.item_id!)) < l.qty_confirmed)) return true;
    for (const l of lines) {
      d.prepare("UPDATE items SET reserved = reserved + ? WHERE id = ?").run(l.qty_confirmed, l.item_id);
      d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)").run(l.item_id, orderId, -l.qty_confirmed, "reserved", now());
    }
    saveTotals(orderId);
    d.prepare("UPDATE orders SET billed_at = ?, invoice_no = COALESCE(invoice_no, ?), credit_verdict = ?, credit_reasons = ? WHERE id = ?").run(now(), nextInvoiceNo(now()), decision.verdict, JSON.stringify(decision.reasons), orderId);
    setStatus(orderId, "awaiting_payment");
    return false;
  });
  if (raced) {
    setStatus(orderId, "awaiting_approval");
    return approve(orderId);
  }
  const o = getOrder(orderId)!;
  const p = payable(o);
  const inv = invoiceNo(o);
  step("bill", `Sent bill ${inv}: ${inr(o.total)} incl. ${inr(o.gst)} GST`, p.discount ? `Pay-now price ${inr(p.amount)} (${p.pct}% prompt-payment discount)` : undefined, "good");

  // Pay sooner, pay less: today's price, the later steps, and when credit runs out.
  const billedAt = o.billed_at ?? now();
  const later = p.until ? tiers().filter((x) => billedAt + x.days * 86_400_000 > p.until!) : [];
  const terms = [
    p.discount ? t(lang, "payNowSave", { amount: inr(p.amount), save: inr(p.discount) }) : "",
    ...later.map((x) => t(lang, "tierLine", { date: day(billedAt + x.days * 86_400_000), pct: x.pct })),
    o.credit_verdict === "credit" ? t(lang, "creditDue", { total: inr(o.total), date: day(p.dueAt), days: creditDays() }) : t(lang, "payFirst"),
  ].filter(Boolean);

  await sendText(o.phone, `*${t(lang, "orderApproved")}*\n${t(lang, "hereIsBill", { inv, total: inr(o.total) })}`);
  await sendDocument(o.phone, `/api/orders/${orderId}/invoice?k=${viewToken(orderId)}`, `Invoice-${orderId}.pdf`, inv);
  const credit = o.credit_verdict === "credit" ? [{ id: `cod:${orderId}`, title: t(lang, "codConfirm") }] : [];
  // In-chat payment card (Razorpay); if it is off or Meta rejects it, fall through to the pay-link buttons below.
  if (
    nativePaymentsOn() &&
    (await sendPaymentCard(o.phone, o, getLines(orderId).filter((l) => l.qty_confirmed > 0), t(lang, "payCardBody"), storeName(), p))
  ) {
    return void (await sendText(o.phone, terms.join("\n"), credit));
  }
  await sendText(o.phone, terms.join("\n"), [{ id: `pay:${orderId}`, title: t(lang, "payUpi", { total: inr(Math.round(p.amount)) }) }, ...credit]);
}

/** The team's decision on an order held for review (licence or credit limit). */
export async function reviewOrder(orderId: number, decision: "credit" | "pay_first" | "deny") {
  const order = getOrder(orderId);
  if (!order || order.status !== "awaiting_review") return false;
  if (decision === "deny") {
    setStatus(orderId, "cancelled");
    db().prepare("UPDATE orders SET credit_reasons = ? WHERE id = ?").run(JSON.stringify([...JSON.parse(order.credit_reasons), "Denied by your team"]), orderId);
    await sendText(order.phone, t(normLang(order.language), "reviewDenied", { id: orderId }));
    return true;
  }
  await bill(orderId, decision);
  return true;
}

// ---------------------------------------------------------------------------
// 4. Payment: online now, or on credit and paid later. Either way the discount is for the day it is paid.
// ---------------------------------------------------------------------------

/** A "captured" payment status from WhatsApp's in-chat payment card. Checks the amount before confirming the order. */
export async function handlePayment(p: {
  reference_id: string;
  amount?: { value: number; offset: number };
  transaction?: { id?: string; pg_transaction_id?: string; status?: string };
}) {
  const orderId = Number(/^ord(\d+)-/.exec(p.reference_id)?.[1]);
  const order = orderId ? getOrder(orderId) : undefined;
  if (!order || p.transaction?.status !== "success") return false;
  const paid = p.amount ? p.amount.value / p.amount.offset : 0;
  // The card carries the price for the day it was sent; allow an hour for a payment made just before the offer ended.
  const lowest = payable(order, Date.now() - 3_600_000).amount;
  if (paid < lowest - 0.01 || paid > order.total + 0.01) {
    console.error("payment amount does not match the order", { orderId, paid, lowest, total: order.total });
    return false;
  }
  return markPaid(orderId, p.transaction.pg_transaction_id ?? p.transaction.id ?? null, paid);
}

async function sendPayLink(orderId: number) {
  const o = getOrder(orderId)!;
  const lang = normLang(o.language);
  const p = payable(o);
  const save = p.discount ? `\n${t(lang, "payNowSave", { amount: inr(p.amount), save: inr(p.discount) })}` : "";
  if (razorpayLive()) {
    try {
      const pl = await createPaymentLink({ id: orderId, invoice_no: o.invoice_no, amount: p.amount, phone: o.phone, name: getCustomer(o.phone)?.name, expireAt: p.until });
      if (process.env.NODE_ENV !== "production") watchPaymentLink(pl.id, (payId) => markPaid(orderId, payId, p.amount)); // no webhook on localhost
      return void (await sendText(o.phone, pl.short_url + save));
    } catch (e) {
      console.error("razorpay link failed", orderId, e); // fall back to the plain UPI link below
    }
  }
  const upi = process.env.UPI_ID ?? "pharmacy@upi";
  const link = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(storeName())}&am=${p.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent("INV-" + orderId)}`;
  await sendText(o.phone, link + save);
}

/**
 * Records a payment: online (UPI, card, the payment link) or a credit bill settled later by cash, cheque or
 * transfer. `amount` is what was actually paid; when it is left out it is the price for today. The difference
 * from the bill is the prompt-payment discount, issued as a credit note.
 */
export async function markPaid(orderId: number, ref: string | null, amount?: number) {
  const order = getOrder(orderId);
  if (!order || !["awaiting_payment", "confirmed_cod"].includes(order.status)) return false;
  const paid = round2(amount ?? payable(order).amount);
  const discount = round2(Math.max(0, order.total - paid));
  const d = db();
  tx(() => {
    if (order.status === "awaiting_payment") {
      for (const l of getLines(orderId).filter((x) => x.qty_confirmed > 0)) {
        d.prepare("UPDATE items SET stock = stock - ?, reserved = reserved - ? WHERE id = ?").run(l.qty_confirmed, l.qty_confirmed, l.item_id);
        consume(l.item_id!, l.qty_confirmed);
        d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)").run(l.item_id, orderId, -l.qty_confirmed, "deducted", now());
      }
    }
    d.prepare("UPDATE orders SET payment_method = COALESCE(payment_method, 'upi'), pay_ref = ?, paid_at = ?, paid_amount = ?, discount = ? WHERE id = ?").run(
      ref, now(), paid, discount, orderId,
    );
    setStatus(orderId, "paid");
  });
  step("payment", `Payment of ${inr(paid)} received for ${invoiceNo(order)}`, discount ? `${inr(discount)} prompt-payment discount, credit note CN-${orderId}` : undefined, "good");
  const lang = normLang(order.language);
  await sendText(order.phone, [t(lang, "paid", { id: orderId, ref: ref ?? "-" }), discount ? t(lang, "paidSaved", { save: inr(discount) }) : ""].filter(Boolean).join("\n"));
  return true;
}

/** The retailer takes the bill on credit: stock is deducted now, payment is due within the credit period. */
async function takeOnCredit(orderId: number) {
  const order = getOrder(orderId);
  if (!order || order.status !== "awaiting_payment" || order.credit_verdict !== "credit") return false;
  const d = db();
  tx(() => {
    for (const l of getLines(orderId).filter((x) => x.qty_confirmed > 0)) {
      d.prepare("UPDATE items SET stock = stock - ?, reserved = reserved - ? WHERE id = ?").run(l.qty_confirmed, l.qty_confirmed, l.item_id);
        consume(l.item_id!, l.qty_confirmed);
      d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)").run(l.item_id, orderId, -l.qty_confirmed, "deducted", now());
    }
    d.prepare("UPDATE orders SET payment_method = 'cod' WHERE id = ?").run(orderId);
    setStatus(orderId, "confirmed_cod");
  });
  step("payment", `${invoiceNo(order)} taken on credit`, `Due by ${day(payable(order).dueAt)}`);
  await sendText(order.phone, t(normLang(order.language), "cod", { id: orderId, date: day(payable(order).dueAt) }));
  return true;
}

export async function cancelOrder(orderId: number) {
  const order = getOrder(orderId);
  if (!order || ["paid", "confirmed_cod", "cancelled"].includes(order.status)) return false;
  const d = db();
  tx(() => {
    if (order.status === "awaiting_payment") {
      for (const l of getLines(orderId).filter((x) => x.qty_confirmed > 0)) {
        d.prepare("UPDATE items SET reserved = reserved - ? WHERE id = ?").run(l.qty_confirmed, l.item_id);
        d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)").run(l.item_id, orderId, l.qty_confirmed, "released", now());
      }
    }
    setStatus(orderId, "cancelled");
  });
  return true;
}

/** Out for delivery. Only once the bill is paid or taken on credit, so a pay-first order cannot ship unpaid. */
export async function dispatchOrder(orderId: number) {
  const order = getOrder(orderId);
  if (!order || !["paid", "confirmed_cod"].includes(order.status) || order.dispatched_at) return false;
  db().prepare("UPDATE orders SET dispatched_at = ? WHERE id = ?").run(now(), orderId);
  await sendText(order.phone, t(normLang(order.language), "dispatched", { id: orderId }));
  return true;
}

// ---------------------------------------------------------------------------
// Buttons the retailer taps
// ---------------------------------------------------------------------------

export async function handleButton(phone: string, id: string, lang: Lang) {
  const [action, oid, lid, extra] = id.split(":");
  if (action === "notnow") return sendText(phone, "👍");
  if (action === "reorder") {
    const due = regularItems(phone).filter((r) => r.dueAgain);
    if (!due.length) return sendText(phone, t(lang, "noPrevious"));
    step("order", "Retailer tapped “Order these” on a reorder reminder", due.map((r) => `${r.name} × ${r.avg_qty}`).join(", "));
    return startOrder(phone, lang, { transcript: "", translation: "Reorder from reminder", items: due.map((r) => ({ said: r.name, match: r.name, qty: r.avg_qty, needed: true })) }, "text");
  }
  const order = getOrder(Number(oid));
  if (!order || order.phone !== phone) return sendText(phone, t(lang, "stale"));
  traceOrder(order.id);
  const L = normLang(order.language);
  const stale = () => sendText(phone, t(L, "stale"));
  switch (action) {
    case "approve":
      return order.status === "awaiting_approval" ? approve(order.id) : stale();
    case "edit":
      if (!["awaiting_approval", "awaiting_customer", "awaiting_confirm"].includes(order.status)) return stale();
      setStatus(order.id, "cancelled");
      return sendText(phone, t(L, "editHelp"));
    case "keep":
    case "drop":
      return order.status === "awaiting_customer" ? decide(order.id, Number(lid), action) : stale();
    case "sub":
      return order.status === "awaiting_customer" ? decide(order.id, Number(lid), "sub", Number(extra)) : stale();
    case "keepall":
    case "suball":
      return order.status === "awaiting_customer" ? decideAll(order.id, action === "suball") : stale();
    case "confirm":
      return order.status === "awaiting_confirm" ? bill(order.id) : stale();
    case "pay":
      return ["awaiting_payment", "confirmed_cod"].includes(order.status) ? sendPayLink(order.id) : stale();
    case "cod":
      return (await takeOnCredit(order.id)) || stale();
    default:
      return stale();
  }
}
