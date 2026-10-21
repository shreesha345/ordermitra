import { db, tx, type Item, type Line, type Order } from "./db";
import { inr, normLang, t, type Lang } from "./i18n";
import { toMp3 } from "./audio";
import { understandOrder, type Media } from "./gemini";
import { createPaymentLink, razorpayLive, watchPaymentLink } from "./razorpay";
import { logIncoming, nativePaymentsOn, sendDocument, sendLanguageCard, sendPaymentCard, sendText } from "./whatsapp";

const GST = 0.05;

const now = () => Date.now();
const round2 = (n: number) => Math.round(n * 100) / 100;
const free = (i: Pick<Item, "stock" | "reserved">) => Math.max(0, i.stock - i.reserved);

export const getOrder = (id: number) => db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as Order | undefined;
export const getLines = (id: number) =>
  db().prepare("SELECT * FROM order_lines WHERE order_id = ? ORDER BY id").all(id) as Line[];
const getItem = (id: number) => db().prepare("SELECT * FROM items WHERE id = ?").get(id) as Item;

function setStatus(id: number, status: string) {
  db().prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
}

function totals(orderId: number) {
  const rows = getLines(orderId).filter((l) => !["not_needed", "unmatched", "dropped"].includes(l.status));
  const subtotal = round2(rows.reduce((s, l) => s + l.qty_confirmed * l.unit_price, 0));
  const gst = round2(subtotal * GST);
  return { subtotal, gst, total: round2(subtotal + gst) };
}

// ---------------------------------------------------------------------------
// Incoming message router
// ---------------------------------------------------------------------------

export type Incoming = {
  phone: string;
  name?: string;
  kind: "text" | "audio" | "image" | "document" | "button";
  text?: string;
  buttonId?: string;
  media?: Media | (() => Promise<Media>);
};

export async function handleIncoming(msg: Incoming) {
  const d = db();
  const existing = d.prepare("SELECT language, lang_set FROM customers WHERE phone = ?").get(msg.phone) as
    | { language: Lang; lang_set: number }
    | undefined;
  if (!existing) {
    d.prepare("INSERT INTO customers (phone, name, language, created_at) VALUES (?,?,?,?)").run(
      msg.phone,
      msg.name || "+" + msg.phone,
      "en",
      now(),
    );
  } else if (msg.name) {
    d.prepare("UPDATE customers SET name = ? WHERE phone = ?").run(msg.name, msg.phone);
  }
  const lang = normLang(existing?.language);
  const chosen = !!existing?.lang_set;

  if (msg.kind === "button" && msg.buttonId?.startsWith("lang:")) {
    logIncoming(msg.phone, "button", msg.text ?? msg.buttonId);
    const L = normLang(msg.buttonId.slice(5));
    d.prepare("UPDATE customers SET language = ?, lang_set = 1 WHERE phone = ?").run(L, msg.phone);
    return sendText(msg.phone, `${t(L, "langSet")}\n\n${t(L, "hello")}`);
  }
  if (msg.kind === "button" && msg.buttonId) {
    logIncoming(msg.phone, "button", msg.text ?? msg.buttonId);
    return handleButton(msg.phone, msg.buttonId, lang);
  }

  logIncoming(msg.phone, msg.kind, msg.text ?? (msg.kind === "audio" ? "🎤 Voice note" : msg.kind === "image" ? "📷 Photo" : "📎 File"));
  // First message of any kind (hi, an order, a voice note): ask for the language before anything else.
  if (!chosen || CHANGE_LANG.test(msg.text ?? "")) return sendLanguageCard(msg.phone);

  let media: Media | undefined;
  try {
    media = typeof msg.media === "function" ? await msg.media() : msg.media;
    if (media?.mime.startsWith("audio/")) media = await toMp3(media);
  } catch (e) {
    console.error("media download failed", e);
    return sendText(msg.phone, t(lang, "nothingFound"));
  }
  if (!media && (!msg.text?.trim() || GREETING.test(msg.text))) return sendText(msg.phone, t(lang, "hello"));

  let understood;
  try {
    understood = await understandOrder({ media, text: msg.text });
  } catch (e) {
    console.error("understandOrder failed", e);
    return sendText(msg.phone, t(lang, "nothingFound"));
  }
  // Every reply stays in the language the customer picked, whatever language the order itself was spoken in.
  if (!understood.items.some((i) => i.match)) {
    console.error("no medicines matched", { kind: msg.kind, mime: media?.mime, bytes: media?.data.length, understood });
    return sendText(msg.phone, t(lang, "nothingFound"));
  }
  return startOrder(msg.phone, lang, understood, media ? (msg.kind === "text" ? "text" : msg.kind) : "text");
}

const GREETING = /^\s*(hi+|hello+|hey+|hai|hlo|namaste|namaskara|namaskar|vanakkam|start|menu|help|नमस्ते|ನಮಸ್ಕಾರ|வணக்கம்|నమస్కారం)\W*$/i;
const CHANGE_LANG = /^\s*(change\s+)?(language|bhasha|भाषा|ಭಾಷೆ|மொழி|భాష)\s*$/i;

async function handleButton(phone: string, id: string, lang: Lang) {
  const [action, oid, lid] = id.split(":");
  const order = getOrder(Number(oid));
  if (!order || order.phone !== phone) return sendText(phone, t(lang, "stale"));
  const L = normLang(order.language);
  const stale = () => sendText(phone, t(L, "stale"));
  switch (action) {
    case "approve":
      return order.status === "awaiting_approval" ? approve(order.id) : stale();
    case "edit":
      if (!["awaiting_approval", "awaiting_confirm"].includes(order.status)) return stale();
      setStatus(order.id, "cancelled");
      return sendText(phone, t(L, "editHelp"));
    case "keep":
    case "drop":
      return order.status === "awaiting_customer" ? decide(order.id, Number(lid), action) : stale();
    case "confirm":
      return order.status === "awaiting_confirm" ? bill(order.id) : stale();
    case "pay":
      return order.status === "awaiting_payment" ? sendPayLink(order.id) : stale();
    case "cod":
      return order.status === "awaiting_payment" ? commit(order.id, "cod", null) : stale();
    default:
      return stale();
  }
}

// ---------------------------------------------------------------------------
// 1. Voice note -> confirmation card
// ---------------------------------------------------------------------------

async function startOrder(phone: string, lang: Lang, u: Awaited<ReturnType<typeof understandOrder>>, source: string) {
  const d = db();
  const orderId = tx(() => {
    const r = d
      .prepare(
        "INSERT INTO orders (phone, language, status, transcript, understood, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(phone, lang, "awaiting_approval", u.transcript, u.translation, source === "audio" ? "voice" : source, now(), now());
    const id = Number(r.lastInsertRowid);
    for (const it of u.items) {
      const item = it.match ? (d.prepare("SELECT * FROM items WHERE name = ?").get(it.match) as Item | undefined) : undefined;
      d.prepare(
        "INSERT INTO order_lines (order_id, item_id, said, name, qty_requested, unit_price, status) VALUES (?,?,?,?,?,?,?)",
      ).run(id, item?.id ?? null, it.said, item?.name ?? it.said, it.qty, item?.price ?? 0, !item ? "unmatched" : it.needed ? "pending" : "not_needed");
    }
    return id;
  });

  const lines = getLines(orderId);
  const rows = lines.map((l) => {
    if (l.status === "not_needed") return `• ${l.name} — ${t(lang, "notNeeded")}`;
    if (l.status === "unmatched") return `• ${l.said} — ${t(lang, "notFound")}`;
    return `• ${l.name} × ${l.qty_requested}`;
  });
  const est = lines.filter((l) => l.status === "pending").reduce((s, l) => s + l.qty_requested * l.unit_price, 0);
  const body = [
    `*${t(lang, "confirmTitle")}* (#${orderId})`,
    `${t(lang, "youSaid")}\n"${u.transcript}"`,
    `${t(lang, "weUnderstood")}\n${rows.join("\n")}`,
    `*${t(lang, "estTotal")}: ${inr(round2(est * (1 + GST)))}*`,
  ].join("\n\n");
  await sendText(phone, body, [
    { id: `approve:${orderId}`, title: t(lang, "approve") },
    { id: `edit:${orderId}`, title: t(lang, "edit") },
  ]);
  for (const l of lines) {
    if (l.item_id && getItem(l.item_id).rx && l.status === "pending") await sendText(phone, t(lang, "rxNeeded", { name: l.name }));
  }
}

// ---------------------------------------------------------------------------
// 2. Approved -> check stock -> bill, or ask the customer item by item
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
      d.prepare("UPDATE order_lines SET status = ?, qty_confirmed = ?, unit_price = ? WHERE id = ?").run(status, qty, item.price, l.id);
      (status === "available" ? okLines : problems).push({ ...l, status, qty_confirmed: qty });
    }
  });

  if (!problems.length) return bill(orderId);

  setStatus(orderId, "awaiting_customer");
  if (okLines.length) {
    const head = [`*${t(lang, "stockChecked")}*`, ...okLines.map((l) => `• ${l.name} × ${l.qty_requested} — ${t(lang, "available")}`)];
    await sendText(order.phone, head.join("\n"));
  }
  for (const l of problems) {
    const have = free(getItem(l.item_id!));
    if (l.status === "short") {
      await sendText(order.phone, t(lang, "onlyHave", { name: l.name, have, want: l.qty_requested }), [
        { id: `keep:${orderId}:${l.id}`, title: t(lang, "addToCart", { n: have }) },
        { id: `drop:${orderId}:${l.id}`, title: t(lang, "dropItem") },
      ]);
    } else {
      await sendText(order.phone, t(lang, "outOfStock", { name: l.name }), [{ id: `drop:${orderId}:${l.id}`, title: t(lang, "dropItem") }]);
    }
  }
}

async function decide(orderId: number, lineId: number, choice: "keep" | "drop") {
  const order = getOrder(orderId)!;
  const lang = normLang(order.language);
  const line = getLines(orderId).find((l) => l.id === lineId);
  if (!line || !["short", "out"].includes(line.status)) return sendText(order.phone, t(lang, "stale"));
  const have = line.item_id ? Math.min(free(getItem(line.item_id)), line.qty_requested) : 0;
  const keep = choice === "keep" && have > 0;
  db()
    .prepare("UPDATE order_lines SET status = ?, qty_confirmed = ? WHERE id = ?")
    .run(keep ? "available" : "dropped", keep ? have : 0, lineId);

  if (getLines(orderId).some((l) => ["short", "out"].includes(l.status))) return; // more items waiting on the customer

  const kept = getLines(orderId).filter((l) => l.qty_confirmed > 0);
  if (!kept.length) {
    setStatus(orderId, "cancelled");
    return sendText(order.phone, t(lang, "allDropped"));
  }
  const tot = totals(orderId);
  db().prepare("UPDATE orders SET subtotal=?, gst=?, total=? WHERE id=?").run(tot.subtotal, tot.gst, tot.total, orderId);
  setStatus(orderId, "awaiting_confirm");
  const rows = getLines(orderId)
    .filter((l) => !["not_needed", "unmatched"].includes(l.status))
    .map((l) =>
      l.status === "dropped"
        ? `• ${l.name} × ${l.qty_requested} — ${t(lang, "dropped")}`
        : `• ${l.name} × ${l.qty_confirmed}${l.qty_confirmed < l.qty_requested ? ` (${l.qty_confirmed}/${l.qty_requested})` : ""} — ${inr(l.qty_confirmed * l.unit_price)}`,
    );
  await sendText(order.phone, [`*${t(lang, "updatedOrder")}* (#${orderId})`, rows.join("\n"), `*${t(lang, "total")}: ${inr(tot.total)}* (GST 5%)`].join("\n\n"), [
    { id: `confirm:${orderId}`, title: t(lang, "confirmUpdated") },
    { id: `edit:${orderId}`, title: t(lang, "edit") },
  ]);
}

// ---------------------------------------------------------------------------
// 3. Bill: reserve stock, send the invoice PDF and pay / confirm buttons
// ---------------------------------------------------------------------------

async function bill(orderId: number): Promise<void> {
  const order = getOrder(orderId)!;
  const lang = normLang(order.language);
  const d = db();
  const raced = tx(() => {
    const lines = getLines(orderId).filter((l) => l.qty_confirmed > 0);
    // stock may have changed since the check; if so, go back through the shortage flow
    if (lines.some((l) => free(getItem(l.item_id!)) < l.qty_confirmed)) return true;
    for (const l of lines) {
      d.prepare("UPDATE items SET reserved = reserved + ? WHERE id = ?").run(l.qty_confirmed, l.item_id);
      d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)").run(l.item_id, orderId, -l.qty_confirmed, "reserved", now());
    }
    const tot = totals(orderId);
    d.prepare("UPDATE orders SET subtotal=?, gst=?, total=? WHERE id=?").run(tot.subtotal, tot.gst, tot.total, orderId);
    setStatus(orderId, "awaiting_payment");
    return false;
  });
  if (raced) {
    setStatus(orderId, "awaiting_approval");
    return approve(orderId);
  }
  const o = getOrder(orderId)!;
  const inv = `INV-${orderId}`;
  await sendText(o.phone, `*${t(lang, "orderApproved")}*\n${t(lang, "hereIsBill", { inv, total: inr(o.total) })}`);
  await sendDocument(o.phone, `/api/orders/${orderId}/invoice`, `Invoice-${orderId}.pdf`, inv);
  const cod = { id: `cod:${orderId}`, title: t(lang, "codConfirm") };
  // In-chat payment card (Razorpay); if it is off or Meta rejects it, fall through to the pay-link buttons below.
  if (
    nativePaymentsOn() &&
    (await sendPaymentCard(o.phone, o, getLines(orderId).filter((l) => l.qty_confirmed > 0), t(lang, "payCardBody"), process.env.STORE_NAME ?? "Sri Ram Medicals"))
  ) {
    return void (await sendText(o.phone, t(lang, "orCod"), [cod]));
  }
  await sendText(o.phone, `${inr(o.total)}`, [
    { id: `pay:${orderId}`, title: t(lang, "payUpi", { total: inr(Math.round(o.total)) }) },
    cod,
  ]);
}

/** A "captured" payment status from WhatsApp's in-chat payment card. Checks the amount before confirming the order. */
export async function handlePayment(p: {
  reference_id: string;
  amount?: { value: number; offset: number };
  transaction?: { id?: string; pg_transaction_id?: string; status?: string };
}) {
  const orderId = Number(/^ord(\d+)-/.exec(p.reference_id)?.[1]);
  const order = orderId ? getOrder(orderId) : undefined;
  if (!order || p.transaction?.status !== "success") return false;
  const paid = p.amount ? Math.round((p.amount.value * 100) / p.amount.offset) : 0;
  if (Math.abs(paid - Math.round(order.total * 100)) > 1) {
    console.error("payment amount does not match the order", { orderId, paid, expected: Math.round(order.total * 100) });
    return false;
  }
  return commit(orderId, "upi", p.transaction.pg_transaction_id ?? p.transaction.id ?? null);
}

async function sendPayLink(orderId: number) {
  const o = getOrder(orderId)!;
  if (razorpayLive()) {
    try {
      const pl = await createPaymentLink({ id: orderId, total: o.total, phone: o.phone, name: (db().prepare("SELECT name FROM customers WHERE phone = ?").get(o.phone) as { name: string | null } | undefined)?.name });
      if (process.env.NODE_ENV !== "production") watchPaymentLink(pl.id, (payId) => commit(orderId, "upi", payId)); // no webhook on localhost
      return void (await sendText(o.phone, pl.short_url));
    } catch (e) {
      console.error("razorpay link failed", orderId, e); // fall back to the plain UPI link below
    }
  }
  const upi = process.env.UPI_ID ?? "pharmacy@upi";
  const link =`upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(process.env.STORE_NAME ?? "Sri Ram Medicals")}&am=${o.total.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Order " + orderId)}`;
  await sendText(o.phone, link);
}

// ---------------------------------------------------------------------------
// 4. Pay / confirm -> deduct the reserved stock for real
// ---------------------------------------------------------------------------

export async function commit(orderId: number, method: "upi" | "cod", ref: string | null) {
  const order = getOrder(orderId);
  if (!order || order.status !== "awaiting_payment") return false;
  const d = db();
  tx(() => {
    for (const l of getLines(orderId).filter((x) => x.qty_confirmed > 0)) {
      d.prepare("UPDATE items SET stock = stock - ?, reserved = reserved - ? WHERE id = ?").run(l.qty_confirmed, l.qty_confirmed, l.item_id);
      d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)").run(l.item_id, orderId, -l.qty_confirmed, "deducted", now());
    }
    d.prepare("UPDATE orders SET payment_method = ?, pay_ref = ? WHERE id = ?").run(method, ref, orderId);
    setStatus(orderId, method === "upi" ? "paid" : "confirmed_cod");
  });
  const lang = normLang(order.language);
  await sendText(order.phone, method === "upi" ? t(lang, "paid", { id: orderId, ref: ref ?? "-" }) : t(lang, "cod", { id: orderId }));
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
