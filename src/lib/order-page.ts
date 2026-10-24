import { computeBill } from "@/lib/billing";
import { store, storeName } from "@/lib/brand";
import { db, type Line } from "@/lib/db";
import { inr, normLang, t, type Key, type Lang } from "@/lib/i18n";
import { countStates, lineViews, orderByToken, qtyText, wroteText, type LineState, type LineView } from "@/lib/order-view";

// The retailer's view of one order (served at /o/<token>), linked from WhatsApp when the list is too long for a message. Plain HTML,
// no script bundle: it has to open fast on a phone with a weak connection. The token in the link is the only key.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STATUS: Record<string, Key> = {
  awaiting_approval: "stOpen", awaiting_customer: "stOpen", awaiting_confirm: "stOpen", awaiting_review: "stReview",
  awaiting_payment: "stBilled", confirmed_cod: "stCredit", paid: "stPaid", cancelled: "stCancelled",
};

// Problems first: that is what the retailer needs to act on.
const SECTIONS: { state: LineState; title: Key; tone: string }[] = [
  { state: "missing", title: "secMissing", tone: "red" },
  { state: "out", title: "secOut", tone: "red" },
  { state: "short", title: "secShort", tone: "amber" },
  { state: "available", title: "secAvailable", tone: "green" },
  { state: "removed", title: "secRemoved", tone: "gray" },
  { state: "not_needed", title: "secNotNeeded", tone: "gray" },
];

function row(lang: Lang, v: LineView, checked: boolean) {
  const l = v.line;
  const qty = l.qty_confirmed && l.qty_confirmed !== l.qty_requested ? l.qty_confirmed : l.qty_requested;
  const notes: string[] = [];
  if (l.unit_note) notes.push(esc(l.unit_note.startsWith("?") ? t(lang, "unitCheck", { x: wroteText(lang, l.unit_note) }) : t(lang, "youWrote", { x: wroteText(lang, l.unit_note) })));
  if (v.state === "short") notes.push(`<b>${esc(t(lang, "youAsked", { want: qtyText(lang, l.qty_requested, v.unit) }))}, ${esc(t(lang, "weHave", { have: qtyText(lang, v.have, v.unit) }))}</b>`);
  if (v.state === "available" && l.qty_confirmed && l.qty_confirmed < l.qty_requested) notes.push(esc(t(lang, "youAsked", { want: qtyText(lang, l.qty_requested, v.unit) })));
  if (v.sub) notes.push(esc(t(lang, "sameMedicine", { sub: v.sub })));
  if (v.state === "missing" && l.said !== l.name) notes.push(`“${esc(l.said)}”`);
  const amount = v.state === "available" && l.unit_price ? inr(Math.round(qty * l.unit_price * (1 + l.gst_rate / 100) * 100) / 100) : "";
  return `<li data-q="${esc(`${l.name} ${l.said}`.toLowerCase())}">
  <div class="name">${esc(v.state === "missing" ? l.said : l.name)}${notes.length ? `<div class="note">${notes.join("<br>")}</div>` : ""}</div>
  <div class="qty">${v.state === "missing" || v.state === "not_needed" ? "" : esc(qtyText(lang, checked || v.state !== "available" ? qty : l.qty_requested, v.unit))}${amount ? `<div class="note">${amount}</div>` : ""}</div>
</li>`;
}

/** The page for this link token, or a 404. */
export function orderPage(token: string) {
  const order = orderByToken(token);
  if (!order) return new Response("This link has expired or is not valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const lang = normLang(order.language);
  const views = lineViews(order.id);
  const n = countStates(views);
  const checked = !["awaiting_approval"].includes(order.status);
  const lines = db().prepare("SELECT * FROM order_lines WHERE order_id = ?").all(order.id) as Line[];
  // Before the stock check: what is in stock now, at today's rates. After: the confirmed quantities.
  const priced = checked
    ? lines.filter((l) => l.qty_confirmed > 0)
    : views.filter((v) => v.state === "available" || v.state === "short").map((v) => ({ ...v.line, qty_confirmed: Math.min(v.have, v.line.qty_requested) }));
  const total = order.total && order.billed_at ? order.total : computeBill(priced, order.igst === 1).total;
  const s = store();
  const wa = (s.phone ?? "").replace(/\D/g, "");
  const summary = [
    n.available && t(lang, "sumAvailable", { n: n.available }),
    n.short && t(lang, "sumShort", { n: n.short }),
    n.out && t(lang, "sumOut", { n: n.out }),
    n.missing && t(lang, "sumMissing", { n: n.missing }),
  ].filter(Boolean) as string[];

  const sections = SECTIONS.map(({ state, title, tone }) => {
    const vs = views.filter((v) => v.state === state);
    if (!vs.length) return "";
    return `<section class="${tone}">
  <h2>${esc(t(lang, title))} <span>${vs.length}</span></h2>
  ${state === "missing" ? `<p class="hint">${esc(t(lang, "missingHint"))}</p>` : ""}
  <ul>${vs.map((v) => row(lang, v, checked)).join("")}</ul>
</section>`;
  }).join("");

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>#${order.id} · ${esc(storeName())}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#14181f;--muted:#5b6472;--line:#e3e6eb;--red:#c62828;--red-bg:#fdecec;--amber:#a15c00;--amber-bg:#fff4e0;--green:#1b7a3d;--green-bg:#e8f6ee;--gray-bg:#eef0f3;--accent:#128c7e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#181c22;--ink:#e8ebf0;--muted:#9aa3b0;--line:#2a3039;--red:#ff8a80;--red-bg:#3a1d1d;--amber:#ffc56b;--amber-bg:#3a2c12;--green:#7fd6a0;--green-bg:#15301f;--gray-bg:#22272e;--accent:#25d366}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari","Noto Sans Kannada","Noto Sans Tamil","Noto Sans Telugu",sans-serif}
main{max-width:640px;margin:0 auto;padding:16px 16px 96px}
header{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.store{font-size:13px;color:var(--muted)}h1{margin:2px 0 4px;font-size:20px}
.status{display:inline-block;font-size:13px;padding:2px 10px;border-radius:99px;background:var(--gray-bg)}
.sum{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.sum span{font-size:13px;background:var(--gray-bg);border-radius:8px;padding:4px 8px}
.total{display:flex;justify-content:space-between;align-items:baseline;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.total b{font-size:20px}
.live{font-size:12px;color:var(--muted);margin:8px 0 0}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);margin-bottom:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden}
h2{margin:0;font-size:15px;padding:10px 14px;display:flex;justify-content:space-between}
.red h2{background:var(--red-bg);color:var(--red)}.amber h2{background:var(--amber-bg);color:var(--amber)}.green h2{background:var(--green-bg);color:var(--green)}.gray h2{background:var(--gray-bg);color:var(--muted)}
.hint{margin:0;padding:8px 14px 0;font-size:13px;color:var(--muted)}
ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;border-top:1px solid var(--line)}li:first-child{border-top:0}
.name{min-width:0;overflow-wrap:anywhere}.qty{text-align:right;white-space:nowrap;font-weight:600}.note{font-size:12.5px;color:var(--muted);font-weight:400;margin-top:2px;white-space:normal}
.red .note b{color:var(--red)}.amber .note b{color:var(--amber)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px}
.bar div{max-width:640px;margin:0 auto;display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:13px;color:var(--muted)}
.bar a{flex-shrink:0;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:10px 14px;border-radius:10px}
</style>
</head>
<body>
<main>
<header>
  <div class="store">${esc(storeName())}</div>
  <h1>#${order.id} · ${esc(t(lang, "itemsN", { n: views.filter((v) => v.state !== "not_needed").length }))}</h1>
  <span class="status">${esc(t(lang, STATUS[order.status] ?? "stOpen"))}</span>
  <div class="sum">${summary.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
  <div class="total"><span>${esc(t(lang, order.billed_at ? "total" : "estTotal"))} (incl. GST)</span><b>${inr(total)}</b></div>
  ${checked ? "" : `<p class="live">${esc(t(lang, "liveStock"))}</p>`}
</header>
${views.length > 12 ? `<input type="search" placeholder="${esc(t(lang, "searchItems"))}" aria-label="${esc(t(lang, "searchItems"))}" oninput="var q=this.value.toLowerCase();document.querySelectorAll('li').forEach(function(l){l.hidden=q&&l.dataset.q.indexOf(q)<0})">` : ""}
${sections}
</main>
<div class="bar"><div><span>${esc(t(lang, "replyOnWa"))}</span>${wa ? `<a href="https://wa.me/${wa}">${esc(t(lang, "openWa"))}</a>` : ""}</div></div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
