"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, FileSpreadsheet, Home, Inbox, MessageCircle, ReceiptText, Settings, ShoppingCart, Store } from "lucide-react";
import { initials } from "@/lib/brand";
import { LangSwitch, useT } from "./lang";
import { LogoMark } from "./logo";

type Badge = "attention" | "requests";
type NavItem = { href: string; label: string; hint: string; icon: typeof Home; badge?: Badge };

// Grouped the way the day goes: what needs me, the stock, the money, then setup.
const GROUPS: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: "/", label: "Today", hint: "What needs you today", icon: Home }] },
  {
    title: "Daily work",
    items: [
      { href: "/orders", label: "Orders", hint: "Every order from WhatsApp", icon: ReceiptText, badge: "attention" },
      { href: "/requests", label: "Returns and calls", hint: "Returns, licences and call-backs", icon: Inbox, badge: "requests" },
      { href: "/customers", label: "Retailers", hint: "Your shops and what they owe", icon: Store },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/inventory", label: "Stock", hint: "What you have and what expires", icon: Boxes },
      { href: "/demand", label: "What to buy", hint: "What sells and what to order", icon: ShoppingCart },
    ],
  },
  { title: "Money", items: [{ href: "/gst", label: "GST filing", hint: "Monthly GST file for your accountant", icon: FileSpreadsheet }] },
  {
    title: "Help and setup",
    items: [
      { href: "/simulator", label: "Practice chat", hint: "Try ordering like a retailer", icon: MessageCircle },
      { href: "/integrations", label: "Settings", hint: "WhatsApp, payments and other connections", icon: Settings },
    ],
  },
];

type Props = { appName: string; storeName: string; attention: number; requests: number };

export function Sidebar({ appName, storeName, attention, requests }: Props) {
  const t = useT();
  const counts: Record<Badge, number> = { attention, requests };
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const link = (n: NavItem) => (
    <Link
      key={n.href}
      href={n.href}
      title={t(n.hint)}
      aria-current={active(n.href) ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active(n.href) ? "bg-primary-soft text-primary" : "text-muted hover:bg-subtle hover:text-ink"
      }`}
    >
      <n.icon className="size-4" aria-hidden />
      {t(n.label)}
      {n.badge && counts[n.badge] > 0 && (
        <span className="ml-auto rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-semibold text-white" aria-label={t("{n} need attention", { n: counts[n.badge] })}>
          {counts[n.badge]}
        </span>
      )}
    </Link>
  );

  return (
    <aside className="sticky top-0 z-10 flex shrink-0 flex-col border-b border-line bg-surface md:h-screen md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 md:pt-5 md:pb-5">
        <LogoMark />
        <span className="text-[17px] font-semibold tracking-tight">{appName}</span>
      </div>
      <nav aria-label={t("Main")} className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:gap-4 md:overflow-visible md:pb-4">
        {GROUPS.map((g, i) => (
          <div key={i} className="flex shrink-0 gap-1 md:flex-col">
            {g.title && <div className="hidden px-3 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase md:block">{t(g.title)}</div>}
            {g.items.map(link)}
          </div>
        ))}
      </nav>
      <div className="mt-auto hidden flex-col gap-3 p-3 md:flex">
        <LangSwitch />
        <div className="flex items-center gap-2.5 rounded-lg bg-subtle p-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-white" aria-hidden>
            {initials(storeName)}
          </div>
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{storeName}</div>
            <div className="text-xs text-muted">{t("Wholesaler")}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
