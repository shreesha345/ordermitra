import { connection, type NextRequest } from "next/server";
import { gstr1, gstr1Sheets, period, type SectionKey } from "@/lib/gstr1";
import { storeGstin } from "@/lib/brand";
import { toCsv, writeXlsx } from "@/lib/xlsx";

/** GSTR-1 for a month: ?period=2026-09, as the whole workbook (default) or one section as CSV (&section=b2b). */
export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  const r = gstr1(period(q.get("period")));
  const base = `GSTR1_${storeGstin()}_${r.period.key.replace("-", "")}`;
  const section = q.get("section") as SectionKey | null;
  if (section && section in r.sections) {
    const s = r.sections[section];
    return new Response(toCsv([s.head, ...s.rows]), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}_${section.replace(/[()]/g, "_")}.csv"` },
    });
  }
  const xlsx = await writeXlsx(gstr1Sheets(r));
  return new Response(Buffer.from(xlsx), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` },
  });
}
