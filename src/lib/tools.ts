import { saveGstin } from "./gst-collect";
import { cleanGstin, stateName, validGstin } from "./gstin";
import { asUnit, UNITS } from "./units";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AiTool, Media } from "./ai";
import { creditDays, creditNote, invoiceNo, licenceProblem, payable, paymentGrade, tiers, unpaidBills } from "./billing";
import { storeName } from "./brand";
import { db, type Customer, type Order } from "./db";
import { inr, t, type Lang } from "./i18n";
import { regularItems } from "./insights";
import { bySalt, catalogue, resolve, search, substitutes, type CatalogueEntry } from "./match";
import { day, getLines, lastOrderItems, startOrder } from "./orders";
import { viewToken } from "./order-view";
import { lookupDrug, tavilyEnabled } from "./tavily";
import { step } from "./trace";
import { sendDocument, sendText } from "./whatsapp";

// The assistant's tools. Each one runs here, against the database, with the business rules enforced in code:
// the model decides what to do, but prices, stock, dues, discounts and credit always come from these functions.

export type Ctx = { phone: string; lang: Lang; customer: Customer; media?: Media; source: string; said: string };

const free = (c: Pick<CatalogueEntry, "stock" | "reserved">) => Math.max(0, c.stock - c.reserved);
const STATUS_KEY = { awaiting_approval: "stOpen", awaiting_customer: "stOpen", awaiting_confirm: "stOpen", awaiting_review: "stReview", awaiting_payment: "stBilled", confirmed_cod: "stCredit", paid: "stPaid", cancelled: "stCancelled" } as const;

const str = { type: "string" } as const;
const int = { type: "integer" } as const;

export const TOOLS: AiTool[] = [
  {
    name: "search_catalogue",
    description: "Find products in our catalogue by brand, generic or local name. Use when you are not sure of the exact catalogue name.",
    parameters: { type: "object", properties: { query: str }, required: ["query"] },
  },
  {
    name: "check_stock",
    description: "Stock, rate and GST for products, with same-composition substitutes for anything short or out of stock. Use for 'do you have', 'rate', 'price' questions.",
    parameters: {
      type: "object",
      properties: { items: { type: "array", items: { type: "object", properties: { name: { ...str, description: "Catalogue name, or what the retailer said" }, qty: int }, required: ["name"] } } },
      required: ["items"],
    },
  },
  {
    name: "lookup_drug",
    description: "Look up a medicine we do not stock, by name only, to learn its composition and strength. Then call find_by_composition to offer what we have.",
    parameters: { type: "object", properties: { name: { ...str, description: "Only the medicine's name, e.g. 'Ascoril LS'" } }, required: ["name"] },
  },
  {
    name: "find_by_composition",
    description: "Our products with a given composition, e.g. 'Paracetamol 650mg'.",
    parameters: { type: "object", properties: { composition: str }, required: ["composition"] },
  },
  {
    name: "place_order",
    description:
      "Create the order and send the retailer a confirmation card with buttons. Call once, with every item. The card lists the items and the estimated total, so do not repeat them in your reply.",
    parameters: {
      type: "object",
      properties: {
        transcript: { ...str, description: "What the retailer said or wrote, in their own language and script" },
        translation: { ...str, description: "The same, in English" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              said: { ...str, description: "The item as the retailer said it" },
              match: { type: ["string", "null"], description: "Exact catalogue name, or null if we do not stock it" },
              qty: { ...int, description: "The number as written, in the unit the retailer used" },
              unit: { type: ["string", "null"], enum: [...UNITS, null], description: "The unit the retailer wrote or said, in any language (patta = strip, goli = tablet, dabba = box, peti/carton = case, botal = bottle), or null if none" },
              needed: { type: "boolean", description: "false if the retailer said they do NOT want it" },
            },
            required: ["said", "match", "qty", "needed"],
          },
        },
      },
      required: ["transcript", "translation", "items"],
    },
  },
  { name: "get_last_order", description: "The retailer's last billed order with quantities. Use for 'same as last time', with or without changes.", parameters: { type: "object", properties: {} } },
  { name: "get_regular_items", description: "What this retailer buys regularly, how often, and what is due for reorder.", parameters: { type: "object", properties: {} } },
  { name: "get_orders", description: "The retailer's recent orders with status, total and whether they are out for delivery.", parameters: { type: "object", properties: {} } },
  {
    name: "get_account",
    description: "The retailer's dues, each unpaid bill with today's pay-now price and due date, credit limit, payment grade, and our credit and discount terms.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "send_payment_options",
    description: "Send the retailer their unpaid bills with Pay buttons at today's discounted price. Use when they want to pay or ask how much they owe.",
    parameters: { type: "object", properties: {} },
  },
  { name: "resend_invoice", description: "Send the invoice PDF of an order again.", parameters: { type: "object", properties: { order_id: int }, required: ["order_id"] } },
  {
    name: "create_return",
    description: "Log a return of expired, near-expiry, damaged or wrong stock for the team to approve. Needs product, quantity and reason; batch and expiry if known (read them from a photo of the strips).",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              said: str,
              match: { type: ["string", "null"] },
              qty: int,
              batch: str,
              expiry: { ...str, description: "YYYY-MM or YYYY-MM-DD" },
              reason: { type: "string", enum: ["expired", "near_expiry", "damaged", "wrong_item", "other"] },
            },
            required: ["said", "qty", "reason"],
          },
        },
        note: str,
      },
      required: ["items"],
    },
  },
  {
    name: "submit_licence",
    description: "The retailer sent a photo of their drug licence: record what it says for the team to verify. Read every licence number and form on it.",
    parameters: {
      type: "object",
      properties: {
        licence_no: { ...str, description: "Licence number(s), e.g. 'KA-DK-20/21-4412'" },
        forms: { ...str, description: "Forms, e.g. '20, 21' or '20B, 21B' or '20F'" },
        holder: { ...str, description: "Firm name on the licence" },
        address: str,
        valid_until: { ...str, description: "YYYY-MM-DD, if shown" },
        gstin: { ...str, description: "If the photo also shows a GSTIN" },
      },
      required: ["licence_no"],
    },
  },
  {
    name: "save_gstin",
    description: "The retailer sent their GSTIN (15 characters, e.g. 29AAKFS4412M1ZR), typed or as a photo of their GST certificate. Saves it after checking it.",
    parameters: { type: "object", properties: { gstin: str }, required: ["gstin"] },
  },
  {
    name: "request_callback",
    description: "Ask a person from our team to call the retailer: complaints, delivery problems, credit limit requests, anything you cannot do.",
    parameters: { type: "object", properties: { reason: str }, required: ["reason"] },
  },
];

// ---------------------------------------------------------------------------

function stockLine(c: CatalogueEntry, qty?: number) {
  const have = free(c);
  const status = have <= 0 ? "out_of_stock" : qty && have < qty ? `short_only_${have}` : "available";
  const subs = status === "available" ? [] : substitutes(c).slice(0, 2).map((s) => ({ name: s.name, rate: s.price, available: free(s) }));
  return { name: c.name, rate: c.price, unit: c.unit, gst_rate: c.gst_rate, composition: c.salt || undefined, schedule: c.schedule || (c.rx ? "H" : undefined), status, substitutes_same_composition: subs };
}

function account(ctx: Ctx) {
  const bills = unpaidBills(ctx.phone).map((b) => {
    const p = payable(b);
    return { invoice: invoiceNo(b), order_id: b.id, billed: day(b.billed_at ?? b.created_at), total: b.total, pay_now: p.amount, discount_now: p.discount, discount_until: p.until ? day(p.until) : null, due_by: day(p.dueAt), overdue_days: p.overdueDays };
  });
  const due = bills.reduce((s, b) => s + b.total, 0);
  const g = paymentGrade(ctx.phone);
  return {
    total_due: due,
    credit_limit: ctx.customer.credit_limit,
    credit_available: Math.max(0, ctx.customer.credit_limit - due),
    payment_grade: g.grade,
    grade_note: g.hint,
    bills,
    terms: { credit_days: creditDays(), prompt_payment_discount: tiers().map((x) => `${x.pct}% if paid within ${x.days} day${x.days === 1 ? "" : "s"} of the bill`) },
    licence: { number: ctx.customer.drug_licence || null, status: ctx.customer.licence_status, problem_for_schedule_h: licenceProblem(ctx.customer, [{ name: "Schedule H medicines", schedule: "H" }]) },
  };
}

/** The dues card with Pay buttons. Also used by payment reminders from the dashboard. */
export async function sendDues(phone: string, lang: Lang, reminder = false) {
  const bills = unpaidBills(phone);
  if (!bills.length) {
    if (!reminder) await sendText(phone, t(lang, "noDues"));
    return false;
  }
  const rows = bills.map((b) => {
    const p = payable(b);
    return p.overdueDays
      ? t(lang, "billOverdue", { inv: invoiceNo(b), amount: inr(b.total), days: p.overdueDays })
      : t(lang, "billLine", { inv: invoiceNo(b), amount: inr(b.total), date: day(p.dueAt) });
  });
  const best = bills.map((b) => ({ b, p: payable(b) })).find((x) => x.p.discount > 0);
  const body = [
    reminder ? t(lang, "reminderHead", { store: storeName() }) : "",
    t(lang, "duesTitle", { due: inr(bills.reduce((s, b) => s + b.total, 0)), n: bills.length }),
    rows.join("\n"),
    best ? t(lang, "payNowLine", { inv: invoiceNo(best.b), amount: inr(best.p.amount), save: inr(best.p.discount) }) : "",
  ].filter(Boolean).join("\n\n");
  // Oldest first: that is the one holding back new credit
  await sendText(phone, body, bills.slice(0, 3).map((b) => ({ id: `pay:${b.id}`, title: t(lang, "payUpi", { total: inr(Math.round(payable(b).amount)) }) })));
  return true;
}

/** "Time to restock" with an Order these button. Returns false when nothing is due. */
export async function sendReorderNudge(phone: string, lang: Lang) {
  const due = regularItems(phone).filter((r) => r.dueAgain);
  if (!due.length) return false;
  await sendText(phone, t(lang, "reorderNudge", { store: storeName(), list: due.map((r) => `• ${r.name} × ${r.avg_qty}`).join("\n") }), [
    { id: "reorder:0", title: t(lang, "orderThese") },
    { id: "notnow:0", title: t(lang, "notNow") },
  ]);
  return true;
}

function saveFile(ctx: Ctx, kind: string) {
  if (!ctx.media) return null;
  const dir = path.join(process.cwd(), "data", kind);
  mkdirSync(dir, { recursive: true });
  const file = `${ctx.phone}-${Date.now()}.${ctx.media.mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"}`;
  writeFileSync(path.join(dir, file), ctx.media.data);
  return `${kind}/${file}`;
}

const createRequest = (ctx: Ctx, kind: string, body: string, details: unknown, file: string | null = null) =>
  Number(
    db()
      .prepare("INSERT INTO requests (phone, kind, body, details, file, created_at) VALUES (?,?,?,?,?,?)")
      .run(ctx.phone, kind, body, JSON.stringify(details), file, Date.now()).lastInsertRowid,
  );

type Args = Record<string, unknown>;
const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** Runs one tool call. Returns what the model sees next; `sent` means the retailer already got a card. */
export async function runTool(name: string, args: Args, ctx: Ctx): Promise<unknown> {
  const list = catalogue();
  switch (name) {
    case "search_catalogue": {
      const hits = search(String(args.query ?? ""), list).slice(0, 6);
      step("search", `Searched the catalogue for “${args.query}”`, hits.map((h) => h.name).join(", ") || "no match");
      return { results: hits.map((h) => stockLine(h)) };
    }
    case "check_stock": {
      const items = arr<{ name: string; qty?: number }>(args.items).map((i) => {
        const c = resolve(i.name, i.name, list);
        return c ? stockLine(c, i.qty) : { name: i.name, status: "not_in_catalogue", suggestion: tavilyEnabled() ? "call lookup_drug to find its composition" : undefined };
      });
      step("stock", `Checked stock for ${items.length} item${items.length === 1 ? "" : "s"}`, items.map((i) => `${i.name}: ${String(i.status).replace(/_/g, " ")}`).join(" · "), items.some((i) => i.status !== "available") ? "warn" : "good");
      return { items };
    }
    case "lookup_drug": {
      const info = await lookupDrug(String(args.name ?? ""));
      if (!info) return { error: tavilyEnabled() ? "No result" : "Drug lookup is not set up" };
      step("web", `Looked up “${args.name}” on drug reference sites`, info.answer.slice(0, 240));
      return { about: info.answer, sources: info.sources.map((s) => s.url) };
    }
    case "find_by_composition": {
      const hits = bySalt(String(args.composition ?? ""), list);
      step("search", `Found ${hits.length} product${hits.length === 1 ? "" : "s"} with composition “${args.composition}”`, hits.map((h) => h.name).join(", ") || undefined, hits.length ? "good" : "warn");
      return { products: hits.map((h) => stockLine(h)) };
    }
    case "place_order": {
      const items = arr<{ said: string; match: string | null; qty: number; unit?: string | null; needed?: boolean }>(args.items)
        .filter((i) => i && (i.said || i.match))
        .map((i) => {
          const c = resolve(i.match, i.said ?? "", list);
          return { said: String(i.said ?? i.match), match: c?.name ?? null, qty: Math.max(1, Math.round(Number(i.qty) || 1)), unit: asUnit(i.unit), needed: i.needed !== false };
        });
      if (!items.some((i) => i.match && i.needed)) return { error: "None of these items are in our catalogue. Tell the retailer, and offer alternatives from check_stock or find_by_composition." };
      step("understand", `Understood ${items.length} item${items.length === 1 ? "" : "s"}`, String(args.translation ?? "").slice(0, 300));
      const r = await startOrder(ctx.phone, ctx.lang, { transcript: String(args.transcript ?? ctx.said), translation: String(args.translation ?? ""), items }, ctx.source);
      return { sent: true, order_id: r.orderId, not_in_catalogue: r.unmatched, note: "The confirmation card with buttons is on the retailer's screen. Only mention items we do not stock, if any." };
    }
    case "get_last_order": {
      const last = lastOrderItems(ctx.phone);
      step("history", last ? `Read last order #${last.order.id} (${day(last.order.created_at)})` : "No earlier order found", last?.items.map((i) => `${i.name} × ${i.qty}`).join(", "));
      return last ? { order_id: last.order.id, date: day(last.order.created_at), items: last.items } : { error: "No earlier order" };
    }
    case "get_regular_items": {
      const r = regularItems(ctx.phone);
      step("history", `Read ${r.length} regular item${r.length === 1 ? "" : "s"}`, r.filter((x) => x.dueAgain).map((x) => x.name).join(", ") || undefined);
      return { items: r.map((x) => ({ name: x.name, usual_qty: x.avg_qty, every_days: x.every, last: day(x.last_at), due_now: x.dueAgain })) };
    }
    case "get_orders": {
      const orders = db().prepare("SELECT * FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 5").all(ctx.phone) as Order[];
      step("history", `Looked up ${orders.length} recent order${orders.length === 1 ? "" : "s"}`);
      return {
        orders: orders.map((o) => ({
          order_id: o.id,
          date: day(o.created_at),
          items: getLines(o.id).filter((l) => l.qty_confirmed > 0 || l.status === "pending").length,
          total: o.total || undefined,
          status: t(ctx.lang, STATUS_KEY[o.status as keyof typeof STATUS_KEY] ?? "stOpen"),
          out_for_delivery: o.dispatched_at ? day(o.dispatched_at) : false,
          prompt_payment_discount_received: o.discount || undefined,
        })),
      };
    }
    case "get_account": {
      const a = account(ctx);
      step("account", `Read the account: ${inr(a.total_due)} due across ${a.bills.length} bill${a.bills.length === 1 ? "" : "s"}`, `Grade ${a.payment_grade} · ${a.grade_note}`);
      return a;
    }
    case "send_payment_options": {
      const sent = await sendDues(ctx.phone, ctx.lang);
      step("account", sent ? "Sent the dues with Pay buttons at today's price" : "No dues to pay", undefined, "good");
      return { sent: true };
    }
    case "resend_invoice": {
      const o = db().prepare("SELECT * FROM orders WHERE id = ? AND phone = ?").get(Number(args.order_id), ctx.phone) as Order | undefined;
      if (!o || !o.total || !o.billed_at) return { error: "No bill for that order" };
      await sendDocument(ctx.phone, `/api/orders/${o.id}/invoice?k=${viewToken(o.id)}`, `Invoice-${o.id}.pdf`, invoiceNo(o));
      step("invoice", `Sent invoice ${invoiceNo(o)} again`, o.discount ? `with credit note of ${inr(creditNote(o).total)}` : undefined);
      return { sent: true };
    }
    case "create_return": {
      const items = arr<{ said: string; match?: string | null; qty: number; batch?: string; expiry?: string; reason: string }>(args.items).map((i) => {
        const c = resolve(i.match, i.said ?? "", list);
        // Did we sell this batch to this retailer? Shown to the team next to the request.
        const sold = c && i.batch
          ? (db().prepare("SELECT COUNT(*) AS n FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.phone = ? AND l.item_id = ? AND l.batch = ? COLLATE NOCASE").get(ctx.phone, c.id, i.batch.trim()) as { n: number }).n > 0
          : null;
        return { said: i.said, name: c?.name ?? i.said, item_id: c?.id ?? null, qty: Math.max(1, Math.round(Number(i.qty) || 1)), batch: i.batch ?? "", expiry: i.expiry ?? "", reason: i.reason ?? "other", rate: c?.price ?? 0, sold_by_us: sold };
      });
      if (!items.length) return { error: "Ask which products, how many, and why." };
      const id = createRequest(ctx, "return", String(args.note ?? ctx.said ?? ""), items, saveFile(ctx, "returns"));
      step("return", `Logged return request R-${id}`, items.map((i) => `${i.name} × ${i.qty}${i.batch ? ` (batch ${i.batch}${i.sold_by_us === false ? ", not a batch we sold them" : ""})` : ""} · ${i.reason.replace("_", " ")}`).join(" · "), items.some((i) => i.sold_by_us === false) ? "warn" : "good");
      await sendText(ctx.phone, t(ctx.lang, "returnNoted", { id, list: items.map((i) => `• ${i.name} × ${i.qty}${i.batch ? ` · ${i.batch}` : ""}`).join("\n") }));
      return { sent: true, request: `R-${id}` };
    }
    case "submit_licence": {
      const details = { licence_no: String(args.licence_no ?? "").trim(), forms: String(args.forms ?? "").trim(), holder: String(args.holder ?? ""), address: String(args.address ?? ""), valid_until: String(args.valid_until ?? ""), gstin: String(args.gstin ?? "").toUpperCase() };
      if (details.gstin && validGstin(details.gstin) && !ctx.customer.gstin) saveGstin(ctx.phone, details.gstin);
      if (!details.licence_no) return { error: "Could not read a licence number. Ask for a clearer photo." };
      const id = createRequest(ctx, "licence", `Drug licence ${details.licence_no}`, details, saveFile(ctx, "licences"));
      // Recorded straight away so the next order knows a licence is on its way; it only counts once the team verifies it.
      db().prepare("UPDATE customers SET drug_licence = ?, licence_forms = ?, licence_expiry = ?, licence_status = 'pending', gstin = CASE WHEN gstin = '' THEN ? ELSE gstin END WHERE phone = ?").run(
        details.licence_no, details.forms, /^\d{4}-\d{2}-\d{2}$/.test(details.valid_until) ? details.valid_until : null, details.gstin, ctx.phone,
      );
      const expired = /^\d{4}-\d{2}-\d{2}$/.test(details.valid_until) && new Date(details.valid_until).getTime() < Date.now();
      step("licence", `Read drug licence ${details.licence_no}`, [details.forms && `Forms ${details.forms}`, details.holder, details.valid_until && `valid until ${details.valid_until}${expired ? " (EXPIRED)" : ""}`].filter(Boolean).join(" · "), expired ? "bad" : "good");
      await sendText(ctx.phone, t(ctx.lang, "licenceNoted", { no: details.licence_no }));
      return { sent: true, request: `L-${id}`, expired };
    }
    case "save_gstin": {
      const g = String(args.gstin ?? "");
      const problem = saveGstin(ctx.phone, g);
      if (problem) return { error: `${problem}. Ask the retailer to check and send it again.` };
      await sendText(ctx.phone, t(ctx.lang, "gstSaved", { gstin: cleanGstin(g), state: stateName(cleanGstin(g)) }));
      return { sent: true };
    }
    case "request_callback": {
      const id = createRequest(ctx, "callback", String(args.reason ?? ctx.said), {});
      step("handoff", `Asked the team to call back (R-${id})`, String(args.reason ?? ""), "warn");
      await sendText(ctx.phone, t(ctx.lang, "callback"));
      return { sent: true };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
