import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Geist } from "next/font/google";
import "./globals.css";
import { AskWidget } from "@/components/ask-widget";
import { LangProvider } from "@/components/lang";
import { Sidebar } from "@/components/sidebar";
import { appName, storeName } from "@/lib/brand";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { attention } from "@/lib/insights";
import { uiLang } from "@/lib/ui-lang-server";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: appName(),
  description: "WhatsApp order desk for pharmaceutical wholesalers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col md:flex-row">
        <Suspense fallback={<aside className="h-14 shrink-0 border-b border-line bg-surface md:h-screen md:w-60 md:border-r md:border-b-0" />}>
          <SidebarData />
        </Suspense>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-[1280px]">
            <Suspense fallback={null}>
              <WithLang>{children}</WithLang>
            </Suspense>
          </div>
        </main>
      </body>
    </html>
  );
}

/** Client components below read the dashboard language from here. */
async function WithLang({ children }: { children: React.ReactNode }) {
  const lang = await uiLang();
  return (
    <LangProvider lang={lang}>
      <div lang={lang}>{children}</div>
      <AskWidget ai={aiEnabled()} />
    </LangProvider>
  );
}

async function SidebarData() {
  await connection();
  const lang = await uiLang();
  return (
    <LangProvider lang={lang}>
    <Sidebar
      appName={appName()}
      storeName={storeName()}
      attention={attention().length}
      requests={(db().prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'open'").get() as { n: number }).n}
    />
    </LangProvider>
  );
}
