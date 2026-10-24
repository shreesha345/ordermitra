import { syncItem } from "./batches";
import { computeBill, creditDays, creditDecision, nextInvoiceNo, payable, round2 } from "./billing";
import { db, tx } from "./db";
import { SIM_PREFIX } from "./whatsapp";

// Demo data for showing the product: a wholesaler's catalogue, six retail pharmacies and two weeks of orders.
// Every phone number starts with SIM_PREFIX, so nothing here is ever sent to WhatsApp.

const DAY = 86_400_000;

// name, aliases, composition, schedule, unit, price, stock, min_stock, batch, expiry (days from today)
const ITEMS: [string, string, string, string, string, number, number, number, string, number][] = [
  ["Dolo 650 (15 tabs)", "paracetamol, fever tablet, bukhar, dolo", "Paracetamol 650mg", "", "strip", 30, 1840, 300, "DL24K19", 420],
  ["Crocin Advance 500mg", "crocin, paracetamol 500", "Paracetamol 500mg", "", "strip", 19, 260, 200, "CR24J02", 300],
  ["Digene Gel 200ml", "antacid, acidity gel, gelusil, digene", "", "", "bottle", 88, 420, 80, "DG24H11", 510],
  ["Pan 40 (15 tabs)", "gas tablet, pan 40", "Pantoprazole 40mg", "", "strip", 142, 30, 100, "PN24L07", 600],
  ["Pantocid 40 (15 tabs)", "pantocid", "Pantoprazole 40mg", "", "strip", 138, 540, 80, "PT24K02", 480],
  ["Cetirizine 10mg (10 tabs)", "allergy tablet, cold tablet, cetirizine", "Cetirizine 10mg", "", "strip", 18, 95, 120, "CT24F21", 75],
  ["Okacet 10 (10 tabs)", "okacet", "Cetirizine 10mg", "", "strip", 19, 400, 80, "OK24G12", 520],
  ["Benadryl Cough Syrup 150ml", "cough syrup, khansi, benadryl", "Diphenhydramine 14.08mg + Ammonium chloride 138mg per 5ml", "", "bottle", 124, 0, 60, "BN24D30", 210],
  ["Diphenhydramine Expectorant 100ml", "generic cough syrup, diphenhydramine", "Diphenhydramine 14.08mg + Ammonium chloride 138mg per 5ml", "", "bottle", 72, 160, 40, "DE24H05", 400],
  ["Cofsils Syrup 100ml", "cofsils, khansi", "", "", "bottle", 108, 180, 50, "CF24E14", 52],
  ["ORS Powder 21g", "ors, electrolyte, jeevan jal, electral", "Oral rehydration salts (WHO)", "", "sachet", 20, 140, 400, "OR24M03", 690],
  ["Volini Pain Spray 40g", "pain spray, body pain, muscle pain, volini", "", "", "can", 218, 160, 40, "VL24G09", 400],
  ["Dettol Antiseptic 250ml", "antiseptic liquid, savlon, dettol", "Chloroxylenol 4.8%", "", "bottle", 128, 300, 60, "DT24C27", 720],
  ["Azithromycin 500mg (3 tabs)", "azithral, antibiotic, azithromycin, azee", "Azithromycin 500mg", "H", "strip", 108, 520, 100, "AZ24K12", 380],
  ["Amoxyclav 625 (10 tabs)", "augmentin, amoxicillin, clavam, antibiotic", "Amoxicillin 500mg + Clavulanic acid 125mg", "H", "strip", 196, 340, 80, "AM24J18", 34],
  ["Metformin 500mg (10 tabs)", "glycomet, sugar tablet, diabetes, metformin", "Metformin 500mg", "H", "strip", 22, 1400, 300, "MF24I05", 540],
  ["Telma 40 (15 tabs)", "telmisartan, bp tablet, pressure tablet, telma", "Telmisartan 40mg", "H", "strip", 214, 380, 100, "TL24H23", 460],
  ["Shelcal 500 (15 tabs)", "calcium, shelcal, calcium tablet", "", "", "strip", 118, 520, 100, "SH24G16", 330],
  ["Becosules (20 caps)", "vitamin b, becosules, multivitamin", "", "", "strip", 46, 75, 150, "BC24F08", 610],
];

// name, city, language, drug licence, licence status, GSTIN, credit limit, days they usually take to pay
const RETAILERS: [string, string, string, string, string, string, number, number][] = [
  ["Sri Durga Medicals", "Kankanady, Mangaluru", "kn", "KA-DK-20/21-4412", "verified", "29AAKFS4412M1ZR", 200000, 0.4], // pays the same day: grade A
  ["Mahaveer Pharma", "Hampankatta, Mangaluru", "hi", "KA-DK-20/21-3807", "verified", "29AAHPM3807L1ZC", 300000, 5],
  ["Lakshmi Medical Stores", "Surathkal", "kn", "KA-DK-20/21-5120", "pending", "29ABLPL5120K1ZF", 150000, 9], // sent a licence photo, not checked yet
  ["Sai Krishna Pharmacy", "Kasaragod, Kerala", "te", "KL-KSD-20/21-1934", "verified", "32AAMFS1934J1Z3", 150000, 3], // other state: IGST
  ["Vel Murugan Medicals", "Puttur", "ta", "", "none", "", 100000, 12], // no licence: Schedule H orders are held
  ["Care Plus Chemists", "Kadri, Mangaluru", "en", "KA-DK-20/21-6075", "verified", "29AAICC6075H1ZB", 200000, 26], // slow payer with an overdue bill
];

const SAY: Record<string, (parts: string[]) => string> = {
  en: (p) => `Please send ${p.join(", ")}. Deliver by evening.`,
  hi: (p) => `${p.join(", ")} bhej dijiye. Shaam tak delivery chahiye.`,
  kn: (p) => `${p.join(", ")} kalisi. Sanje olage delivery beku.`,
  ta: (p) => `${p.join(", ")} anuppunga. Saayangaalam delivery venum.`,
  te: (p) => `${p.join(", ")} pampandi. Saayantram lopu delivery kaavali.`,
};

/** Small seeded PRNG so every reset produces the same story. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export const demoAllowed = () =>
  process.env.DEMO_MODE === "1" || (db().prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n === 0;

export function phoneOf(i: number) {
  return `${SIM_PREFIX}${String(100001 + i)}`;
}

type DemoItem = { id: number; name: string; price: number; rx: number; batch: string; expiry: string; gst_rate: number; hsn: string };

/** Wipes orders, retailers, chats, requests and stock, then loads the demo set. */
export function loadDemo() {
  const d = db();
  const r = rng(42);
  const now = Date.now();
  const iso = (days: number) => new Date(now + days * DAY).toISOString().slice(0, 10);

  tx(() => {
    d.exec("DELETE FROM order_lines; DELETE FROM orders; DELETE FROM stock_movements; DELETE FROM messages; DELETE FROM customers; DELETE FROM items; DELETE FROM requests; DELETE FROM agent_runs; DELETE FROM batches;");
    d.exec("DELETE FROM sqlite_sequence WHERE name IN ('orders','order_lines','stock_movements','messages','items','requests','agent_runs','batches')");

    const insItem = d.prepare(
      "INSERT INTO items (name, aliases, salt, schedule, rx, unit, price, stock, min_stock, batch, expiry, hsn, gst_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,'3004',5)",
    );
    for (const [name, aliases, salt, sch, unit, price, stock, min, batch, exp] of ITEMS) insItem.run(name, aliases, salt, sch, sch ? 1 : 0, unit, price, stock, min, batch, iso(exp));
    const items = d.prepare("SELECT id, name, price, rx, batch, expiry, gst_rate, hsn FROM items").all() as DemoItem[];

    // Stock per batch: the main batch from the list above, plus older batches for a few products, one of
    // them already expired and some close to expiry, so the expiry report has something to show.
    const MFR: Record<string, string> = { Dolo: "Micro Labs", Crocin: "GSK", Digene: "Abbott", "Pan 40": "Alkem", Pantocid: "Sun Pharma", Cetirizine: "Cipla", Okacet: "Cipla", Benadryl: "Kenvue", Diphenhydramine: "Cipla", Cofsils: "Cipla", ORS: "FDC", Volini: "Sun Pharma", Dettol: "Reckitt", Azithromycin: "Alembic", Amoxyclav: "Abbott", Metformin: "USV", Telma: "Glenmark", Shelcal: "Torrent", Becosules: "Pfizer" };
    const insBatch = d.prepare("INSERT INTO batches (item_id, batch, expiry, qty, mrp, rack, updated_at) VALUES (?,?,?,?,?,?,?)");
    items.forEach((i, k) => {
      const mfr = Object.entries(MFR).find(([w]) => i.name.startsWith(w))?.[1] ?? "";
      d.prepare("UPDATE items SET mfr = ? WHERE id = ?").run(mfr, i.id);
      const stock = (d.prepare("SELECT stock FROM items WHERE id = ?").get(i.id) as { stock: number }).stock;
      const rack = `${String.fromCharCode(65 + (k % 4))}${String(k + 1).padStart(2, "0")}`;
      const mrp = round2(i.price * 1.32);
      insBatch.run(i.id, i.batch, i.expiry, stock, mrp, rack, now);
      const old: Record<string, [string, number, number]> = { Crocin: ["CR23F11", -12, 40], Cofsils: ["CF24A02", 18, 36], Digene: ["DG24B07", 75, 60], Telma: ["TL24C19", 140, 25] };
      const extra = Object.entries(old).find(([w]) => i.name.startsWith(w))?.[1];
      if (extra) insBatch.run(i.id, extra[0], iso(extra[1]), extra[2], mrp, rack, now);
    });
    for (const i of items) syncItem(i.id);
    // Strips (or bottles) in a box, so "2 dabba" can be turned into strips
    for (const [prefix, n] of [["Dolo", 10], ["Pan 40", 10], ["Pantocid", 10], ["Metformin", 20], ["Telma", 10], ["Dettol", 24], ["Digene", 12], ["ORS", 25]] as const) {
      d.prepare("UPDATE items SET box_qty = ? WHERE name LIKE ?").run(n, `${prefix}%`);
    }

    const insCust = d.prepare(
      `INSERT INTO customers (phone, name, language, lang_set, city, drug_licence, licence_forms, licence_expiry, licence_status, gstin, credit_limit, created_at)
       VALUES (?,?,?,1,?,?,?,?,?,?,?,?)`,
    );
    RETAILERS.forEach(([name, city, lang, dl, status, gst, limit], i) =>
      insCust.run(phoneOf(i), name, lang, city, dl, dl ? "20, 21" : "", dl ? iso(400 + i * 90) : null, status, gst, limit, now - 60 * DAY),
    );

    const insOrder = d.prepare(
      `INSERT INTO orders (phone, language, status, transcript, understood, source, subtotal, gst, total, payment_method, pay_ref, igst, billed_at, paid_at, discount, paid_amount, dispatched_at, credit_verdict, credit_reasons, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insLine = d.prepare(
      "INSERT INTO order_lines (order_id, item_id, said, name, qty_requested, qty_confirmed, unit_price, gst_rate, hsn, batch, expiry, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const insMove = d.prepare("INSERT INTO stock_movements (item_id, order_id, change, kind, at) VALUES (?,?,?,?,?)");
    const insMsg = d.prepare("INSERT INTO messages (phone, direction, kind, body, buttons, doc_url, at) VALUES (?,?,?,?,?,?,?)");

    type Opts = { status: string; paidAt?: number; verdict?: string; reasons?: string[]; dispatched?: boolean; quiet?: boolean };
    const addOrder = (ri: number, at: number, o: Opts, lines: { item: DemoItem; qty: number }[]) => {
      const [, , lang, , , gstin] = RETAILERS[ri];
      const phone = phoneOf(ri);
      const igst = gstin.startsWith("32") ? 1 : 0;
      const short = (n: string) => n.replace(/\s*\(.*\)$/, "");
      const said = lines.map((l) => `${short(l.item.name)} ${l.qty}`);
      const transcript = SAY[lang](said);
      const confirmed = !["awaiting_approval"].includes(o.status);
      const bill = computeBill(lines.map((l) => ({ name: l.item.name, hsn: l.item.hsn, batch: l.item.batch, expiry: l.item.expiry, qty_confirmed: l.qty, unit_price: l.item.price, gst_rate: l.item.gst_rate })), igst === 1);
      const billed = ["awaiting_payment", "confirmed_cod", "paid"].includes(o.status);
      const billedAt = billed ? at + 5 * 60_000 : null;
      const price = billedAt && o.paidAt ? payable({ total: bill.total, billed_at: billedAt, created_at: at }, o.paidAt) : null;
      const paid = o.status === "paid";
      const method = paid ? (o.paidAt && o.paidAt - billedAt! > DAY ? "cod" : "upi") : o.status === "confirmed_cod" ? "cod" : null;
      const source = r() < 0.55 ? "voice" : r() < 0.6 ? "text" : r() < 0.75 ? "image" : "sheet";
      const id = Number(
        insOrder.run(
          phone, lang, o.status, transcript, SAY.en(said), source,
          confirmed ? bill.subtotal : 0, confirmed ? bill.gst : 0, confirmed ? bill.total : 0,
          method, paid ? `UPI${Math.floor(r() * 1e8)}` : null, igst,
          billedAt, paid ? o.paidAt! : null, paid ? price!.discount : 0, paid ? price!.amount : 0,
          o.dispatched ? (o.paidAt ?? at) + 2 * 3_600_000 : null,
          o.verdict ?? (billed ? "credit" : ""), JSON.stringify(o.reasons ?? []),
          at, paid ? o.paidAt! : at + 40 * 60_000,
        ).lastInsertRowid,
      );
      for (const l of lines) {
        insLine.run(id, l.item.id, `${short(l.item.name)} ${l.qty}`, l.item.name, l.qty, confirmed ? l.qty : 0, l.item.price, l.item.gst_rate, l.item.hsn, l.item.batch, l.item.expiry,
          confirmed ? "available" : "pending");
        if (paid || o.status === "confirmed_cod") insMove.run(l.item.id, id, -l.qty, "deducted", at + 40 * 60_000);
        if (o.status === "awaiting_payment") {
          d.prepare("UPDATE items SET reserved = reserved + ? WHERE id = ?").run(l.qty, l.item.id);
          insMove.run(l.item.id, id, -l.qty, "reserved", at + 5 * 60_000);
        }
      }
      if (o.quiet) return id; // older history: orders only, no chat
      const inLabel = { voice: "🎤 Voice note", image: "📷 Photo", sheet: "📎 File", text: transcript }[source] ?? transcript;
      insMsg.run(phone, "in", source === "voice" ? "audio" : source === "sheet" ? "document" : source, inLabel, null, null, at);
      const list = lines.map((l) => `• ${l.item.name} × ${l.qty}`).join("\n");
      const total = `₹${bill.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
      if (o.status === "awaiting_approval") {
        insMsg.run(phone, "out", "buttons", `*Please confirm your order* (#${id})\n\n${list}\n\n*Estimated total: ${total}* (incl. GST)`, JSON.stringify([
          { id: `approve:${id}`, title: "Yes, confirm ✅" },
          { id: `edit:${id}`, title: "Change" },
        ]), null, at + 20_000);
      } else if (o.status === "awaiting_review") {
        insMsg.run(phone, "out", "text", `Thank you! Order #${id} is with our team for a quick check. We will confirm shortly.`, null, null, at + 60_000);
      } else if (o.status === "cancelled") {
        insMsg.run(phone, "out", "text", `Order #${id} cancelled.`, null, null, at + 20_000);
      } else {
        const p = payable({ total: bill.total, billed_at: billedAt, created_at: at }, billedAt!);
        insMsg.run(phone, "out", "text", `*Order approved ✅*\nHere is your digital bill INV-${id}. Total ${total}.`, null, null, at + 5 * 60_000);
        insMsg.run(phone, "out", "document", `INV-${id}`, null, `/api/orders/${id}/invoice`, at + 5 * 60_000 + 2000);
        const terms = o.verdict === "pay_first"
          ? `💰 Pay now: *₹${p.amount.toLocaleString("en-IN")}* (you save ₹${p.discount.toLocaleString("en-IN")})\nAn earlier bill is overdue, so this order must be paid before dispatch. Clear your dues to get credit again.`
          : `💰 Pay now: *₹${p.amount.toLocaleString("en-IN")}* (you save ₹${p.discount.toLocaleString("en-IN")})\nFull amount ${total} is due by ${new Date(p.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} (${creditDays()} days credit).`;
        insMsg.run(phone, "out", "buttons", terms, JSON.stringify([{ id: `pay:${id}`, title: `Pay ₹${Math.round(p.amount).toLocaleString("en-IN")} via UPI` }, ...(o.verdict === "pay_first" ? [] : [{ id: `cod:${id}`, title: "Take on credit" }])]), null, at + 5 * 60_000 + 4000);
        if (paid) {
          insMsg.run(phone, "out", "text", `Payment received ✅ Order #${id} is confirmed.${price!.discount ? `\nYou saved ₹${price!.discount.toLocaleString("en-IN")} by paying early 🎉` : ""}`, null, null, o.paidAt!);
        }
        if (o.status === "confirmed_cod") insMsg.run(phone, "out", "text", `Order #${id} is confirmed on credit ✅`, null, null, at + 40 * 60_000);
      }
      return id;
    };

    const nonRx = items.filter((i) => !i.rx);
    // 12 weeks of orders, so the demand forecast has history. Some products follow the season: ORS, allergy
    // and cough medicines pick up, vitamins and antacids slow down; the rest stay level.
    const TREND: Record<string, number> = { ORS: 1, Cetirizine: 0.9, Cofsils: 0.7, Volini: 0.5, Becosules: -0.7, Pantocid: -0.6, Shelcal: -0.4 };
    const weight = (i: DemoItem, day: number) => Math.max(0.15, 1 + (Object.entries(TREND).find(([w]) => i.name.startsWith(w))?.[1] ?? 0) * (0.5 - day / 84) * 1.6);
    const pickWeighted = (pool: DemoItem[], day: number) => {
      const total = pool.reduce((a, i) => a + weight(i, day), 0);
      let x = r() * total;
      return pool.find((i) => (x -= weight(i, day)) < 0) ?? pool[pool.length - 1];
    };
    for (let day = 84; day >= 1; day--) {
      const quiet = day > 13;
      const n = 4 + Math.floor(r() * 5) + (day % 7 === 0 ? -2 : 0); // quieter Sundays
      // shop hours, 9am to 6pm, in order so ids and times agree
      const times = Array.from({ length: n }, () => new Date(now - day * DAY).setHours(9, 0, 0, 0) + r() * 9 * 3_600_000).sort((x, y) => x - y);
      for (let k = 0; k < n; k++) {
        const ri = Math.floor(r() * RETAILERS.length);
        const pool = RETAILERS[ri][4] === "verified" ? items : nonRx;
        const count = 2 + Math.floor(r() * 5);
        const chosen = [...new Set(Array.from({ length: count }, () => pickWeighted(pool, day)))].filter((i) => i.name !== "Benadryl Cough Syrup 150ml");
        const at = times[k];
        // Each retailer pays at their own pace; a bill not yet paid by now is on credit.
        const paidAt = at + RETAILERS[ri][7] * DAY * (0.6 + 0.8 * r());
        const status = r() < 0.06 ? "cancelled" : paidAt < now ? "paid" : "confirmed_cod";
        addOrder(ri, at, { status, paidAt: status === "paid" ? paidAt : undefined, dispatched: status !== "cancelled", quiet }, chosen.map((item) => ({ item, qty: Math.max(1, Math.round((1 + Math.floor(r() * 10)) * Math.sqrt(weight(item, day)))) * (item.price > 100 ? 5 : 10) })));
      }
    }

    const it = (name: string) => items.find((i) => i.name.startsWith(name))!;
    // Care Plus: a credit bill from 38 days ago, still unpaid, so it is overdue.
    addOrder(5, now - 38 * DAY, { status: "confirmed_cod", dispatched: true }, [{ item: it("Volini"), qty: 20 }, { item: it("Dettol"), qty: 24 }, { item: it("Digene"), qty: 30 }]);

    // Today: a live queue with something in every state, including the checks a person must look at.
    const today = now - 3 * 3_600_000;
    addOrder(0, today, { status: "paid", paidAt: today + 20 * 60_000, dispatched: true }, [{ item: it("Dolo"), qty: 200 }, { item: it("Pan 40"), qty: 30 }, { item: it("Shelcal"), qty: 20 }]);
    addOrder(1, today + 25 * 60_000, { status: "awaiting_payment" }, [{ item: it("Metformin"), qty: 150 }, { item: it("Telma"), qty: 40 }, { item: it("Digene"), qty: 24 }]);
    // The same rule billing uses: the 38-day-old bill is past its credit period
    const overdueReason = creditDecision(phoneOf(5), 0, []).reasons;
    const payFirst = addOrder(5, today + 50 * 60_000, {
      status: "awaiting_payment",
      verdict: "pay_first",
      reasons: overdueReason,
    }, [{ item: it("Volini"), qty: 10 }, { item: it("Dettol"), qty: 12 }]);
    addOrder(2, today + 80 * 60_000, { status: "confirmed_cod" }, [{ item: it("ORS"), qty: 100 }, { item: it("Cetirizine"), qty: 60 }]);
    const held = addOrder(4, today + 110 * 60_000, {
      status: "awaiting_review",
      verdict: "review",
      reasons: ["Azithromycin 500mg (3 tabs) (Schedule H) needs a drug licence, and none is on file"],
    }, [{ item: it("Azithromycin"), qty: 30 }, { item: it("Dolo"), qty: 100 }, { item: it("Cofsils"), qty: 24 }]);
    addOrder(3, today + 140 * 60_000, { status: "awaiting_approval" }, [{ item: it("Becosules"), qty: 50 }, { item: it("Crocin"), qty: 80 }]);

    // What the AI agent handed to the team
    const insReq = d.prepare("INSERT INTO requests (phone, kind, body, details, status, created_at) VALUES (?,?,?,?,?,?)");
    const amox = it("Amoxyclav");
    insReq.run(phoneOf(0), "return", "Amoxyclav near expiry, please take back 20 strips", JSON.stringify([
      { said: "Amoxyclav 625 20 strips", name: amox.name, item_id: amox.id, qty: 20, batch: amox.batch, expiry: amox.expiry.slice(0, 7), reason: "near_expiry", rate: amox.price,
        sold_by_us: !!d.prepare("SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.phone = ? AND l.item_id = ?").get(phoneOf(0), amox.id) },
    ]), "open", now - 2 * 3_600_000);
    insReq.run(phoneOf(2), "licence", "Drug licence KA-DK-20/21-5120", JSON.stringify({
      licence_no: "KA-DK-20/21-5120", forms: "20, 21", holder: "Lakshmi Medical Stores", address: "Main Road, Surathkal, Mangaluru 575014", valid_until: iso(700), gstin: "29ABLPL5120K1ZF",
    }), "open", now - 5 * 3_600_000);
    insReq.run(phoneOf(5), "callback", "Wants to talk about a higher credit limit before the festival season", "{}", "open", now - 90 * 60_000);

    // Sample timelines of the AI agent's work, so an order page shows them before anyone has used the simulator.
    const insRun = d.prepare("INSERT INTO agent_runs (phone, input, steps, reply, provider, ms, order_id, at) VALUES (?,?,?,?,?,?,?,?)");
    const heldTotal = (d.prepare("SELECT total FROM orders WHERE id = ?").get(held) as { total: number }).total;
    insRun.run(phoneOf(4), "🎤 Voice note", JSON.stringify([
      { kind: "read", label: "Sent the voice note to the AI agent", detail: "38 KB" },
      { kind: "understand", label: "Understood 3 items", detail: SAY.en(["Azithromycin 30", "Dolo 650 100", "Cofsils Syrup 24"]) },
      { kind: "order", label: `Created order #${held}`, detail: `3 items, about ₹${round2(heldTotal).toLocaleString("en-IN")} incl. GST`, tone: "good" },
      { kind: "licence", label: "Asked for the drug licence", detail: "Azithromycin 500mg (3 tabs) (Schedule H) needs a drug licence, and none is on file", tone: "warn" },
    ]), "", "demo", 4200, held, today + 110 * 60_000);
    insRun.run(phoneOf(4), "Tapped “Yes, confirm ✅”", JSON.stringify([
      { kind: "stock", label: "Checked stock: 3 of 3 items available", tone: "good" },
      { kind: "credit", label: "Credit check: sent to your team to approve or deny", detail: "Azithromycin 500mg (3 tabs) (Schedule H) needs a drug licence, and none is on file", tone: "bad" },
    ]), "", "", 180, held, today + 112 * 60_000);
    insRun.run(phoneOf(5), "Tapped “Yes, confirm ✅”", JSON.stringify([
      { kind: "stock", label: "Checked stock: 2 of 2 items available", tone: "good" },
      { kind: "credit", label: "Credit check: must pay before dispatch", detail: overdueReason.join(" · "), tone: "warn" },
      { kind: "bill", label: `Sent bill INV-${payFirst}`, detail: "Pay-now price with the 2% prompt-payment discount", tone: "good" },
    ]), "", "", 240, payFirst, today + 52 * 60_000);

    // GST invoice numbers in the order bills were issued, and the same numbers in everything that mentions them.
    // Highest id first, so "INV-1" is never replaced inside "INV-12".
    const billed = d.prepare("SELECT id, billed_at FROM orders WHERE billed_at IS NOT NULL ORDER BY billed_at, id").all() as { id: number; billed_at: number }[];
    for (const o of billed) d.prepare("UPDATE orders SET invoice_no = ? WHERE id = ?").run(nextInvoiceNo(o.billed_at), o.id);
    for (const o of [...billed].sort((a, b) => b.id - a.id)) {
      const no = (d.prepare("SELECT invoice_no FROM orders WHERE id = ?").get(o.id) as { invoice_no: string }).invoice_no;
      const from = `INV-${o.id}`;
      d.prepare("UPDATE messages SET body = REPLACE(body, ?, ?) WHERE body LIKE ?").run(from, no, `%${from}%`);
      d.prepare("UPDATE orders SET credit_reasons = REPLACE(credit_reasons, ?, ?) WHERE credit_reasons LIKE ?").run(from, no, `%${from}%`);
      d.prepare("UPDATE agent_runs SET steps = REPLACE(steps, ?, ?) WHERE steps LIKE ?").run(from, no, `%${from}%`);
    }
  });
}
