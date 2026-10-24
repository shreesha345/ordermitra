import JSZip from "jszip";

// Spreadsheets from distributors and pharmacies: .xlsx (including ones with Excel tables, logos and several
// sheets, which ExcelJS cannot open), .csv and .tsv. The .xlsx is read straight from its XML, values only.

export type Table = { sheet: string; rows: string[][] };

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Text inside every <t> of a shared or inline string, joined (rich text is split into several runs). */
const runs = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

/** "C12" -> 2 (zero-based column). */
function colIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

async function readXlsx(buf: Buffer): Promise<Table[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("This file is not a valid .xlsx. Open it in Excel and save it again as .xlsx or CSV.");
  }
  const text = (p: string) => zip.file(p)?.async("string") ?? Promise.resolve("");
  const shared = [...(await text("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]));
  const rels = new Map([...(await text("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    /Id="([^"]+)"/.exec(m[0])?.[1] ?? "",
    (/Target="([^"]+)"/.exec(m[0])?.[1] ?? "").replace(/^\/?(xl\/)?/, "xl/"),
  ]));
  const sheets = [...(await text("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(/name="([^"]*)"/.exec(m[0])?.[1] ?? "Sheet"),
    path: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? "") ?? "",
  }));

  const out: Table[] = [];
  for (const s of sheets) {
    const xml = await text(s.path);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const value = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? runs(body) : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : decode(v ?? "");
        row[ref ? colIndex(ref) : row.length] = value.trim();
      }
      rows.push(Array.from(row, (x) => x ?? ""));
    }
    out.push({ sheet: s.name, rows: rows.filter((r) => r.some(Boolean)) });
  }
  return out;
}

/** CSV / TSV with quoted fields, "" escapes and newlines inside quotes. */
function readDelimited(text: string): Table[] {
  const delim = (text.split("\n")[0].match(/\t/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell.trim()]);
  return [{ sheet: "Sheet1", rows: rows.filter((r) => r.some(Boolean)) }];
}

export const isSheet = (name: string, mime = "") =>
  /\.(xlsx|xlsm|csv|tsv|xls)$/i.test(name) || /spreadsheetml|ms-excel|text\/csv|tab-separated/.test(mime);

/** Every sheet in the file, empty rows dropped. */
export async function readTables(buf: Buffer, name: string, mime = ""): Promise<Table[]> {
  if (/\.xls$/i.test(name) || mime === "application/vnd.ms-excel") {
    throw new Error("Old Excel files (.xls) cannot be read. Open it in Excel and use Save As → .xlsx or CSV.");
  }
  if (/\.(csv|tsv)$/i.test(name) || /csv|tab-separated|text\/plain/.test(mime)) return readDelimited(buf.toString("utf8").replace(/^﻿/, ""));
  return readXlsx(buf);
}

/** The sheet with the most data, skipping cover and notes sheets. */
export const mainTable = (tables: Table[]) => [...tables].sort((a, b) => b.rows.length - a.rows.length)[0];

/** A sheet as plain text for the AI: one line per row, cells separated by " | ". */
export function tableText(t: Table, maxRows = 200) {
  const lines = t.rows.slice(0, maxRows).map((r) => r.join(" | "));
  return `Sheet "${t.sheet}" (${t.rows.length} rows${t.rows.length > maxRows ? `, first ${maxRows} shown` : ""}):\n${lines.join("\n")}`;
}

/** Excel stores dates as days since 1899-12-30. 46000 -> "2025-12-09". Text dates like "03/27" or "Mar-27" -> first of that month. */
export function toIsoDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return s.length === 7 ? `${s}-01` : s;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = /^(\d{1,2})[/\-.](\d{2,4})$/.exec(s) ?? /^([a-z]{3})[a-z]*[\s/\-.']*(\d{2,4})$/i.exec(s);
  if (m) {
    const month = /^\d+$/.test(m[1]) ? Number(m[1]) : months.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}-01`;
  }
  const d = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s); // Indian dd/mm/yyyy
  if (d) return `${d[3].length === 2 ? 2000 + Number(d[3]) : d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  return null;
}
