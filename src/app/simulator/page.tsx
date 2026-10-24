import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { aiEnabled } from "@/lib/ai";
import { SIM_PREFIX } from "@/lib/whatsapp";
import { getT } from "@/lib/ui-lang-server";
import { Header } from "@/components/ui";
import { Simulator } from "@/components/simulator";

export default function SimulatorPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Data />
    </Suspense>
  );
}

async function Data() {
  await connection();
  const t = await getT();
  const d = db();
  // node:sqlite rows have a null prototype, which client components cannot receive, so copy them
  const retailers = (
    d.prepare("SELECT phone, name, city, language FROM customers WHERE phone LIKE ? ORDER BY name").all(`${SIM_PREFIX}%`) as {
      phone: string; name: string; city: string; language: string;
    }[]
  ).map((r) => ({ ...r }));
  // Sample orders built from real catalogue items, so they always match something.
  const top = (d.prepare("SELECT name FROM items WHERE stock > 0 ORDER BY stock DESC LIMIT 4").all() as { name: string }[]).map((i) =>
    i.name.replace(/\s*\(.*\)$/, ""),
  );
  const samples =
    top.length >= 3
      ? [
          { label: "English", text: `Please send ${top[0]} 100 strips, ${top[1]} 30 and ${top[2]} 24` },
          { label: "Kannada (Roman)", text: `${top[0]} 50, ${top[3] ?? top[1]} 20 kalisi` },
          { label: "Hindi (Roman)", text: `${top[1]} 40 aur ${top[2]} 12 bhej do, ${top[0]} nahi chahiye` },
          { label: "Units and Indian numerals", text: `${top[0]} ५० पत्ता, ${top[1]} 2 dabba, ${top[2]} 100 goli` },
        ]
      : [];
  // Requests that need several steps, built from the catalogue so they always make sense.
  const out = d.prepare("SELECT i.name FROM items i WHERE i.stock - i.reserved <= 0 AND i.salt != '' AND EXISTS (SELECT 1 FROM items j WHERE j.id != i.id AND j.salt = i.salt AND j.stock - j.reserved > 0) LIMIT 1").get() as { name: string } | undefined;
  const ret = d.prepare("SELECT name, batch FROM items WHERE batch != '' AND expiry IS NOT NULL ORDER BY expiry LIMIT 1").get() as { name: string; batch: string } | undefined;
  const short = (n: string) => n.replace(/\s*\(.*\)$/, "");
  const asks = [
    top[0] && { label: "Several things at once", text: `Same as my last order but add 20 more ${top[0]}. Also how much do I owe?` },
    out && { label: "Out of stock: finds a substitute", text: `Is ${short(out.name)} available? What is the rate?` },
    ret && { label: "Return near-expiry stock", text: `I want to return 10 strips of ${short(ret.name)}, batch ${ret.batch}, expiring next month` },
    { label: "Credit and discount", text: "If I pay today how much discount do I get?" },
    { label: "Order status", text: "Where is my order? Has it been dispatched?" },
    { label: "Send a GSTIN", text: "My GSTIN is 29AAKFS4412M1ZR" },
  ].filter(Boolean) as { label: string; text: string }[];
  const tr = (xs: { label: string; text: string }[]) => xs.map((x) => ({ ...x, label: t(x.label) }));
  return (
    <>
      <Header
        title={t("Practice chat")}
        sub={t("Pretend to be a retailer and see what they see. Send an order, a voice note or a photo, or ask about stock or payments. Nothing is sent on real WhatsApp.")}
      />
      <Simulator retailers={retailers} samples={tr(samples)} asks={tr(asks)} ai={aiEnabled()} />
    </>
  );
}
