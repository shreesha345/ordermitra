import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const globalForDb = globalThis as unknown as { intovaDb?: DatabaseSync; intovaDbVersion?: number };

const SEED_ITEMS: [string, string, string, number, number, number, number][] = [
  // name, aliases, unit, price, stock, min_stock, rx
  ["Digene Gel 200ml", "antacid, acidity gel, gelusil, digene", "bottle", 95, 140, 20, 0],
  ["Dettol Antiseptic 250ml", "antiseptic liquid, savlon, dettol", "bottle", 140, 62, 15, 0],
  ["Benadryl Cough Syrup 150ml", "cough syrup, khansi, benadryl", "bottle", 135, 0, 10, 0],
  ["ORS Powder 21g", "ors, electrolyte, jeevan jal", "sachet", 22, 4, 10, 0],
  ["Dolo 650 (15 tabs)", "paracetamol, fever tablet, bukhar, dolo", "strip", 32, 85, 20, 0],
  ["Volini Pain Spray 40g", "pain spray, body pain, muscle pain, volini", "can", 240, 27, 8, 0],
  ["Cetirizine 10mg (10 tabs)", "allergy tablet, cold tablet, cetirizine", "strip", 28, 9, 15, 0],
  ["Crocin Advance 500mg", "crocin, paracetamol 500", "strip", 20, 3, 10, 0],
  ["Cofsils Syrup 100ml", "cough syrup, cofsils, khansi", "bottle", 118, 24, 8, 0],
  ["Azithromycin 500mg (3 tabs)", "azithral, antibiotic, azithromycin", "strip", 118, 30, 10, 1],
];

function addColumn(db: DatabaseSync, table: string, column: string, type: string) {
  if (!(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function init(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      aliases TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'unit',
      price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 10,
      rx INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL,
      transcript TEXT NOT NULL DEFAULT '',
      understood TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'voice',
      subtotal REAL NOT NULL DEFAULT 0,
      gst REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT,
      pay_ref TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      item_id INTEGER REFERENCES items(id),
      said TEXT NOT NULL,
      name TEXT NOT NULL,
      qty_requested INTEGER NOT NULL DEFAULT 0,
      qty_confirmed INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id),
      order_id INTEGER,
      change INTEGER NOT NULL,
      kind TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      buttons TEXT,
      doc_url TEXT,
      at INTEGER NOT NULL
    );
  `);
  // 1 once the customer has picked a language from the card; until then we ask before anything else.
  addColumn(db, "customers", "lang_set", "INTEGER NOT NULL DEFAULT 0");
  // Retailer profile: a wholesaler may only sell to licensed pharmacies, and sells on credit up to a limit.
  addColumn(db, "customers", "city", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "customers", "drug_licence", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "customers", "gstin", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "customers", "credit_limit", "REAL NOT NULL DEFAULT 50000");
  // Licence: forms held (e.g. "20,21" for retail, "20F" for Schedule X), expiry, and whether the team checked it.
  addColumn(db, "customers", "licence_forms", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "customers", "licence_expiry", "TEXT"); // YYYY-MM-DD
  addColumn(db, "customers", "licence_status", "TEXT NOT NULL DEFAULT 'none'"); // none | pending | verified | rejected
  addColumn(db, "items", "batch", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "items", "expiry", "TEXT"); // YYYY-MM-DD
  // Composition and strength, e.g. "Paracetamol 650mg". Only an exact match is offered as a substitute.
  // Drugs and Cosmetics Rules schedule: '' (over the counter), H, H1 or X. H/H1/X need a verified licence.
  addColumn(db, "items", "schedule", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "items", "salt", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "items", "hsn", "TEXT NOT NULL DEFAULT '3004'");
  addColumn(db, "items", "gst_rate", "REAL NOT NULL DEFAULT 5");
  // Snapshot on each bill line, so an old invoice never changes when the catalogue does.
  addColumn(db, "order_lines", "gst_rate", "REAL NOT NULL DEFAULT 5");
  addColumn(db, "order_lines", "hsn", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "order_lines", "batch", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "order_lines", "expiry", "TEXT");
  addColumn(db, "orders", "igst", "INTEGER NOT NULL DEFAULT 0"); // 1 when the retailer is in another state
  addColumn(db, "orders", "billed_at", "INTEGER"); // credit period and prompt-payment discount run from here
  addColumn(db, "orders", "paid_at", "INTEGER");
  addColumn(db, "orders", "discount", "REAL NOT NULL DEFAULT 0"); // prompt-payment discount, issued as a credit note
  addColumn(db, "orders", "paid_amount", "REAL NOT NULL DEFAULT 0");
  addColumn(db, "orders", "dispatched_at", "INTEGER");
  addColumn(db, "orders", "credit_verdict", "TEXT NOT NULL DEFAULT ''"); // credit | pay_first | review
  addColumn(db, "orders", "credit_reasons", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, "items", "mfr", "TEXT NOT NULL DEFAULT ''"); // manufacturer / marketer
  addColumn(db, "orders", "invoice_no", "TEXT");
  addColumn(db, "items", "box_qty", "INTEGER NOT NULL DEFAULT 0"); // selling units in one box or case, for "2 boxes"
  addColumn(db, "orders", "view_token", "TEXT");
  addColumn(db, "customers", "gst_unregistered", "INTEGER NOT NULL DEFAULT 0"); // said they have no GSTIN: B2C on the GST return
  addColumn(db, "customers", "gst_asked_at", "INTEGER"); // when we last asked for the GSTIN, so we do not ask on every order // the retailer's link to the full order, for long lists
  addColumn(db, "order_lines", "unit_note", "TEXT NOT NULL DEFAULT ''"); // what the retailer wrote, when it was converted: "100 tablet" // GST serial, consecutive within a financial year: INV/26-27/0001
  // Stock per batch, so each expiry date is tracked (see batches.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id),
      batch TEXT NOT NULL,
      expiry TEXT,
      qty INTEGER NOT NULL DEFAULT 0,
      mrp REAL NOT NULL DEFAULT 0,
      rack TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      UNIQUE (item_id, batch)
    );
    CREATE INDEX IF NOT EXISTS batches_expiry ON batches (expiry);
  `);
  // Things the assistant hands to a person: returns, callbacks.
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      file TEXT,
      created_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      input TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      reply TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      ms INTEGER NOT NULL DEFAULT 0,
      order_id INTEGER,
      at INTEGER NOT NULL
    );
    -- Every change the dashboard assistant proposes or makes: what was asked, what changed, and how to undo it.
    CREATE TABLE IF NOT EXISTS assistant_actions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '[]',
      reasons TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      request TEXT NOT NULL DEFAULT '',
      before TEXT,
      after TEXT,
      created_at INTEGER NOT NULL,
      done_at INTEGER
    );
  `);
  addColumn(db, "requests", "file", "TEXT"); // saved photo or PDF, e.g. a drug licence
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
  if (n === 0) {
    const ins = db.prepare(
      "INSERT INTO items (name, aliases, unit, price, stock, min_stock, rx) VALUES (?,?,?,?,?,?,?)",
    );
    for (const [name, aliases, unit, price, stock, min, rx] of SEED_ITEMS) {
      ins.run(name, aliases, unit, price, stock, min, rx);
    }
  }
}

// Bump when init() changes. A dev server keeps its connection across hot reloads, so without this
// a new column would never get added until a restart.
const SCHEMA_VERSION = 12;

export function db(): DatabaseSync {
  if (!globalForDb.intovaDb) {
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    globalForDb.intovaDb = new DatabaseSync(path.join(dir, "intova.db"));
  }
  if (globalForDb.intovaDbVersion !== SCHEMA_VERSION) {
    init(globalForDb.intovaDb);
    globalForDb.intovaDbVersion = SCHEMA_VERSION;
  }
  return globalForDb.intovaDb;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  if (d.isTransaction) return fn(); // already inside one: the outer transaction commits or rolls back everything
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export type Item = {
  id: number;
  name: string;
  aliases: string;
  unit: string;
  price: number;
  stock: number;
  reserved: number;
  min_stock: number;
  rx: number;
  batch: string;
  expiry: string | null;
  salt: string;
  schedule: "" | "H" | "H1" | "X";
  hsn: string;
  gst_rate: number;
  mfr: string;
  box_qty: number;
};
export type Batch = { id: number; item_id: number; batch: string; expiry: string | null; qty: number; mrp: number; rack: string; updated_at: number };
export type Customer = {
  phone: string;
  name: string;
  language: string;
  lang_set: number;
  city: string;
  drug_licence: string;
  gstin: string;
  gst_unregistered: number;
  gst_asked_at: number | null;
  credit_limit: number;
  created_at: number;
  licence_forms: string;
  licence_expiry: string | null;
  licence_status: "none" | "pending" | "verified" | "rejected";
};
export type Order = {
  id: number;
  phone: string;
  language: string;
  status: string;
  transcript: string;
  understood: string;
  source: string;
  subtotal: number;
  gst: number;
  total: number;
  payment_method: string | null;
  pay_ref: string | null;
  created_at: number;
  updated_at: number;
  igst: number;
  billed_at: number | null;
  invoice_no: string | null;
  view_token: string | null;
  paid_at: number | null;
  discount: number;
  paid_amount: number;
  dispatched_at: number | null;
  credit_verdict: string;
  credit_reasons: string;
};
export type Line = {
  id: number;
  order_id: number;
  item_id: number | null;
  said: string;
  name: string;
  qty_requested: number;
  qty_confirmed: number;
  unit_price: number;
  gst_rate: number;
  hsn: string;
  batch: string;
  expiry: string | null;
  unit_note: string;
  status: "pending" | "available" | "short" | "out" | "dropped" | "not_needed" | "unmatched";
};
export type Request = {
  id: number;
  phone: string;
  kind: "return" | "callback" | "licence";
  body: string;
  details: string; // JSON: ReturnLine[] for returns, LicenceDetails for licences
  file: string | null; // path under data/, e.g. the licence photo
  status: "open" | "approved" | "rejected" | "done";
  created_at: number;
  closed_at: number | null;
};
export type Step = { kind: string; label: string; detail?: string; tone?: "good" | "warn" | "bad" };
export type AgentRun = {
  id: number;
  phone: string;
  input: string;
  steps: string; // JSON Step[]
  reply: string;
  provider: string;
  ms: number;
  order_id: number | null;
  at: number;
};
export type Message = {
  id: number;
  phone: string;
  direction: "in" | "out";
  kind: string;
  body: string;
  buttons: string | null;
  doc_url: string | null;
  at: number;
};
