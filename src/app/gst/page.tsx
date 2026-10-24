import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AlertTriangle, CalendarClock, CheckCircle2, Download, ReceiptText, Users, type LucideIcon } from "lucide-react";
import { gstDates, gstr1, period, type GstDate, type SectionKey } from "@/lib/gstr1";
import type { T } from "@/lib/ui-lang";
import { getT, uiLang } from "@/lib/ui-lang-server";
import { BTN_PRIMARY, BTN_SECONDARY, Card, CardHead, Header, inr, More, TD, TH } from "@/components/ui";

export default function GstPage({ searchParams }: PageProps<"/gst">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Gst searchParams={searchParams} />
    </Suspense>
  );
}

const SECTIONS: { key: SectionKey; title: string; sub: string }[] = [
  { key: "b2b", title: "B2B invoices (4A)", sub: "Bills to retailers with a GSTIN, one row per invoice and tax rate" },
  { key: "b2cs", title: "B2C small (7)", sub: "Bills to retailers without a GSTIN, by place of supply and rate, less credit notes" },
  { key: "cdnr", title: "Credit notes to registered retailers (9B)", sub: "Prompt-payment discounts, dated the day the discounted payment came in" },
  { key: "hsn(b2b)", title: "HSN summary, B2B (12)", sub: "Net of credit notes" },
  { key: "hsn(b2c)", title: "HSN summary, B2C (12)", sub: "Net of credit notes" },
  { key: "docs", title: "Documents issued (13)", sub: "Serial ranges of invoices and credit notes" },
];

// Rows shown on the page per section; the files have all of them
const SHOW = 25;

async function Gst({ searchParams }: Pick<PageProps<"/gst">, "searchParams">) {
  await connection();
  const t = await getT();
  const sp = await searchParams;
  const p = period(typeof sp.period === "string" ? sp.period : null);
  const r = gstr1(p);
  // The last 12 months to choose from
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    return period(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  const file = (extra = "") => `/api/gst?period=${p.key}${extra}`;
  const tax = r.totals.igst + r.totals.cgst + r.totals.sgst;
  const locale = `${await uiLang()}-IN`;
  const dates = gstDates(p);
  const day = (at: number) => new Date(at).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const [send, fileBy, payBy] = dates;

  return (
    <>
      <Header title={t("GST filing")} sub={t("Your GST for the month, worked out from the bills you sent. Download the file and give it to your accountant.")}>
        <form className="flex items-center gap-2">
          <label htmlFor="period" className="sr-only">{t("Month")}</label>
          <select id="period" name="period" defaultValue={p.key} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button className={BTN_SECONDARY}>{t("Show")}</button>
        </form>
        <a href={file()} className={BTN_PRIMARY}>
          <Download className="size-4" aria-hidden /> {t("Download for your accountant")}
        </a>
      </Header>

      <Card className="mb-6 overflow-hidden">
        <CardHead title={t("Dates for {month}", { month: p.label })} sub={t("If you file GST every month. If you file every 3 months, ask your accountant for your dates.")} />
        <div className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
          {dates.map((d, i) => <DateBox key={d.key} n={i + 1} d={d} t={t} locale={locale} />)}
        </div>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <CardHead title={t("{month} in short", { month: p.label })} sub={r.counts.invoices ? t("{n} bills sent", { n: r.counts.invoices }) : t("No bills this month")} />
        <div className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
          <Big label={t("You billed")} value={inr(r.invoiceValue)} hint={t("Total of your bills, with GST")} />
          <Big
            label={t("Your sales")}
            value={inr(r.totals.taxable)}
            hint={r.discounts ? t("Before GST, after {amount} of early-payment discounts", { amount: inr(r.discounts) }) : t("Before GST")}
          />
          <Big label={t("GST you collected")} value={inr(r2(tax))} hint={t("Your accountant takes off the GST you paid when buying stock. You pay the rest.")} strong />
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title={t("Who you billed")} />
          <dl className="flex flex-col gap-4 px-5 pb-5 text-sm">
            <Row icon={Users} label={t("Shops with a GST number")} sub={t("{n} bills. They can claim back the GST you charged.", { n: r.counts.b2b })} value={inr(r.value.withGstin)} />
            <Row icon={ReceiptText} label={t("Shops without a GST number")} sub={t("{n} bills", { n: r.counts.b2c })} value={inr(r.value.withoutGstin)} />
          </dl>
        </Card>
        <Card className="overflow-hidden">
          <CardHead title={t("GST by rate")} />
          {r.byRate.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>{t("Rate")}</th>
                  <th className={`${TH} text-right`}>{t("Sales")}</th>
                  <th className={`${TH} text-right`}>{t("GST")}</th>
                </tr>
              </thead>
              <tbody>
                {r.byRate.map((x) => (
                  <tr key={x.rate} className="border-t border-line">
                    <td className={TD}>{x.rate}%</td>
                    <td className={`${TD} num text-right`}>{inr(x.taxable)}</td>
                    <td className={`${TD} num text-right font-medium`}>{inr(x.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted">{t("No bills this month")}</p>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHead title={t("Before you file")} />
        <div className="flex flex-col gap-2 px-5 pb-5 text-sm">
          {r.checks.map((c) => (
            <div key={c.text} className={`flex flex-wrap items-start gap-2.5 rounded-lg border px-4 py-3 ${c.tone === "red" ? "border-danger/30 bg-danger-soft text-danger" : "border-warn/30 bg-warn-soft text-warn"}`}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{t(c.text, c.vars)}</span>
              {c.href && <Link href={c.href} className="font-semibold underline underline-offset-2">{t(c.action ?? "Open")}</Link>}
            </div>
          ))}
          {!r.checks.length && (
            <div className="flex items-center gap-2.5 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-success">
              <CheckCircle2 className="size-4" aria-hidden /> {t("Everything looks fine. The file is ready.")}
            </div>
          )}
        </div>
      </Card>

      <Card className="mb-6">
        <CardHead title={t("What to do")} />
        <ol className="flex flex-col gap-3 px-5 pb-5 text-sm">
          <Step n={1}>{r.checks.some((c) => c.tone === "red") ? t("Fix the red points above.") : t("Nothing to fix. Go to the next step.")}</Step>
          <Step n={2}>{t("By {date}, press “Download for your accountant” and send the file to them on WhatsApp or email. It has everything they need for {month}.", { date: day(send.at), month: p.label })}</Step>
          <Step n={3}>{t("Your accountant files your sales by {d1}.", { d1: day(fileBy.at) })}</Step>
          <Step n={4}>{t("Pay the GST your accountant tells you by {d2}.", { d2: day(payBy.at) })}</Step>
        </ol>
      </Card>

      <More label={t("Details for your accountant")}>
        <div className="flex flex-col gap-6 p-5">
          <Card>
            <CardHead title={t("Filing it yourself on the GST portal")} />
            <ol className="list-decimal space-y-1 px-5 pb-5 pl-10 text-sm text-muted">
              <li>{t("Download the GSTR-1 Excel file for the month.")}</li>
              <li>{t("Open the GST offline tool, choose GSTR-1 and the month, then Import Files → Import Excel and pick the file.")}</li>
              <li>{t("Check the totals, generate the JSON file, and upload it on the GST portal (Returns dashboard → GSTR-1 → Prepare offline).")}</li>
              <li>{t("For GSTR-3B 3.1(a), use the totals below: taxable value and tax, net of credit notes.")}</li>
            </ol>
          </Card>

          <Card className="overflow-hidden">
            <CardHead title={t("GSTR-3B, Table 3.1(a)")} sub={t("Outward taxable supplies (other than zero rated, nil rated and exempted)")} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{["Taxable value", "Integrated tax", "Central tax", "State/UT tax", "Cess"].map((h) => <th key={h} className={TH}>{t(h)}</th>)}</tr></thead>
                <tbody><tr>{[r.totals.taxable, r.totals.igst, r.totals.cgst, r.totals.sgst, 0].map((v, i) => <td key={i} className={`${TD} num font-medium`}>{inr(v)}</td>)}</tr></tbody>
              </table>
            </div>
          </Card>

          {SECTIONS.map(({ key, title, sub }) => {
            const s = r.sections[key];
            return (
              <Card key={key} className="overflow-hidden">
                <CardHead title={t(title)} sub={`${t(sub)} · ${t("{n} rows", { n: s.rows.length })}`}>
                  {s.rows.length > 0 && (
                    <a href={file(`&section=${encodeURIComponent(key)}`)} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <Download className="size-3.5" aria-hidden /> {t("Download")}
                    </a>
                  )}
                </CardHead>
                {s.rows.length ? (
                  <div className="max-h-[26rem] overflow-auto border-t border-line">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-surface"><tr>{s.head.map((h) => <th key={h} className={`${TH} whitespace-nowrap`}>{h}</th>)}</tr></thead>
                      <tbody>
                        {s.rows.slice(0, SHOW).map((row, i) => (
                          <tr key={i} className="border-t border-line">
                            {row.map((v, j) => <td key={j} className={`whitespace-nowrap px-4 py-2 ${typeof v === "number" ? "num text-right" : ""}`}>{v ?? ""}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s.rows.length > SHOW && <p className="px-4 py-2 text-xs text-muted">{t("{n} more rows in the file.", { n: s.rows.length - SHOW })}</p>}
                  </div>
                ) : (
                  <p className="border-t border-line px-5 py-3 text-sm text-muted">{t("Nothing in this section")}</p>
                )}
              </Card>
            );
          })}

          <p className="text-xs text-faint">
            {t("Bills to retailers without a GSTIN are taken as supplies within your state. Units (UQC) follow the selling unit: bottles BTL, tubes TUB, boxes BOX, everything else NOS. Check with your accountant before the first filing.")}
          </p>
        </div>
      </More>
    </>
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One deadline: the date, the weekday, and how far away it is, coloured by how close. */
function DateBox({ n, d, t, locale }: { n: number; d: GstDate; t: T; locale: string }) {
  const date = new Date(d.at);
  const when =
    d.days < 0 ? t(d.days === -1 ? "Was yesterday" : "Was {n} days ago", { n: -d.days }) : d.days === 0 ? t("Today") : d.days === 1 ? t("Tomorrow") : t("In {n} days", { n: d.days });
  const tone = d.days < 0 ? "bg-subtle text-muted" : d.days <= 2 ? "bg-danger-soft text-danger" : d.days <= 7 ? "bg-warn-soft text-warn" : "bg-primary-soft text-primary";
  return (
    <div className={`bg-surface px-5 py-4 ${d.days < 0 ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{n}</span>
        {t(d.title)}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <CalendarClock className="size-4 shrink-0 self-center text-muted" aria-hidden />
        <span className="text-xl font-semibold">{date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{date.toLocaleDateString(locale, { weekday: "long" })}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${tone}`}>{when}</span>
      </div>
      <div className="mt-2 text-xs text-muted">{t(d.detail)}</div>
    </div>
  );
}

function Big({ label, value, hint, strong }: { label: string; value: string; hint: string; strong?: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${strong ? "text-primary" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{hint}</div>
    </div>
  );
}

function Row({ icon: Icon, label, sub, value }: { icon: LucideIcon; label: string; sub: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <dt className="font-medium">{label}</dt>
        <dd className="text-xs text-muted">{sub}</dd>
      </div>
      <div className="num font-semibold">{value}</div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
