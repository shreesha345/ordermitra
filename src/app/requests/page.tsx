import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getT } from "@/lib/ui-lang-server";
import { BadgeCheck, ImageIcon, Inbox, PhoneCall, Undo2 } from "lucide-react";
import { db, type Request } from "@/lib/db";
import { now } from "@/lib/insights";
import type { LicenceDetails, ReturnLine } from "@/lib/requests";
import { ago, Card, Empty, Header, inr, Pill, ROW, TD, TH, type Tone } from "@/components/ui";
import { RequestActions } from "@/components/request-actions";
import type { T } from "@/lib/ui-lang";

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Requests />
    </Suspense>
  );
}

type Row = Request & { name: string | null };

const KIND = {
  return: { icon: Undo2, label: "Return", tone: "amber" as Tone },
  licence: { icon: BadgeCheck, label: "Drug licence", tone: "blue" as Tone },
  callback: { icon: PhoneCall, label: "Wants a call", tone: "gray" as Tone },
};
const DONE: Record<string, { tone: Tone; label: string }> = {
  approved: { tone: "green", label: "Approved" },
  rejected: { tone: "red", label: "Rejected" },
  done: { tone: "green", label: "Done" },
};
const REASON: Record<string, string> = { expired: "Expired", near_expiry: "Near expiry", damaged: "Damaged", wrong_item: "Wrong item", other: "Other" };

function ReturnDetails({ lines, t }: { lines: ReturnLine[]; t: T }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full">
        <thead><tr>{["Item", "Qty", "Batch", "Expiry", "Reason", "Value"].map((h) => <th key={h} className={TH}>{t(h)}</th>)}</tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={ROW}>
              <td className={`${TD} font-medium`}>{l.name}</td>
              <td className={TD}>{l.qty}</td>
              <td className={TD}>
                {l.batch || "—"}{" "}
                {l.sold_by_us === true && <Pill tone="green">{t("Sold by us")}</Pill>}
                {l.sold_by_us === false && <Pill tone="red">{t("Not a batch we sold them")}</Pill>}
              </td>
              <td className={`${TD} text-muted`}>{l.expiry || "—"}</td>
              <td className={TD}>{t(REASON[l.reason] ?? l.reason)}</td>
              <td className={`${TD} num`}>{l.rate ? inr(l.qty * l.rate) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LicenceView({ l, t }: { l: LicenceDetails; t: T }) {
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(l.valid_until) && new Date(l.valid_until).getTime() < now();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted">{t("Licence no.")}</dt><dd className="font-medium">{l.licence_no}</dd>
      {l.forms && <><dt className="text-muted">{t("Forms")}</dt><dd>{l.forms}</dd></>}
      {l.holder && <><dt className="text-muted">{t("Holder")}</dt><dd>{l.holder}</dd></>}
      {l.address && <><dt className="text-muted">{t("Address")}</dt><dd>{l.address}</dd></>}
      <dt className="text-muted">{t("Valid until")}</dt>
      <dd>{l.valid_until || t("Not shown")} {expired && <Pill tone="red">{t("Expired")}</Pill>}</dd>
      {l.gstin && <><dt className="text-muted">GSTIN</dt><dd>{l.gstin}</dd></>}
    </dl>
  );
}

async function Requests() {
  await connection();
  const t = await getT();
  const rows = db()
    .prepare(
      `SELECT r.*, c.name FROM requests r LEFT JOIN customers c ON c.phone = r.phone
       ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 100`,
    )
    .all() as Row[];
  const open = rows.filter((r) => r.status === "open");

  return (
    <>
      <Header
        title={t("Returns and calls")}
        sub={t("Things retailers asked for on WhatsApp that need a person: returns, drug licences to check, and call-backs. The retailer is told on WhatsApp when you decide.")}
      />
      <Card className="overflow-hidden">
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const k = KIND[r.kind] ?? KIND.callback;
              const details = JSON.parse(r.details) as ReturnLine[] | LicenceDetails;
              return (
                <li key={r.id} className={`flex flex-col gap-3 px-5 py-4 ${r.status === "open" ? "" : "opacity-70"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-muted"><k.icon className="size-4" aria-hidden /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">R-{r.id}</span>
                          <Pill tone={k.tone}>{t(k.label)}</Pill>
                          <Link href={`/customers/${r.phone}`} className="font-medium text-primary hover:underline">{r.name ?? `+${r.phone}`}</Link>
                          <span className="text-muted">· {ago(r.created_at, t)}</span>
                        </div>
                        {r.body && <p className="mt-1 text-sm text-muted">“{r.body}”</p>}
                      </div>
                    </div>
                    {r.status === "open" ? <RequestActions id={r.id} kind={r.kind} /> : <Pill tone={DONE[r.status]?.tone ?? "gray"}>{t(DONE[r.status]?.label ?? r.status)}</Pill>}
                  </div>
                  {r.kind === "return" && Array.isArray(details) && <ReturnDetails lines={details} t={t} />}
                  {r.kind === "licence" && !Array.isArray(details) && <LicenceView l={details} t={t} />}
                  {r.file && (
                    <a href={`/api/requests/${r.id}/file`} target="_blank" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                      <ImageIcon className="size-4" aria-hidden /> {t("Photo the retailer sent")}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={Inbox} title={t("Nothing waiting")}>{t("When a retailer asks to return stock, sends a licence photo, or wants a call, it shows up here.")}</Empty>
        )}
      </Card>
      {open.length > 0 && <p className="mt-3 text-xs text-muted">{t("{n} waiting. Once you approve a licence, the retailer can buy licence-only medicines.", { n: open.length })}</p>}
    </>
  );
}
