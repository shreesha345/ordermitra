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
  if (!(db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).some((c) => c.name === "lang_set")) {
    db.exec("ALTER TABLE customers ADD COLUMN lang_set INTEGER NOT NULL DEFAULT 0");
  }
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
const SCHEMA_VERSION = 2;

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
  status: "pending" | "available" | "short" | "out" | "dropped" | "not_needed" | "unmatched";
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
