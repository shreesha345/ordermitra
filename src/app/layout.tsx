import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Intova",
  description: "Voice orders on WhatsApp for pharmacies",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex">
        <Suspense fallback={<aside className="w-60 shrink-0 border-r border-line bg-surface" />}>
          <Sidebar />
        </Suspense>
        <main className="min-w-0 flex-1 p-8">{children}</main>
      </body>
    </html>
  );
}
