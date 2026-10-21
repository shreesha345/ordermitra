"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/orders", label: "Orders" },
  { href: "/inventory", label: "Inventory" },
  { href: "/customers", label: "Customers" },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-1 border-r border-line bg-surface p-5">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-white">I</div>
        <span className="text-lg font-bold">Intova</span>
      </div>
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-primary-soft text-primary" : "text-muted hover:bg-bg"}`}
          >
            {n.label}
          </Link>
        );
      })}
      <div className="mt-auto flex items-center gap-2.5 rounded-lg bg-bg p-3">
        <div className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">SR</div>
        <div className="text-sm">
          <div className="font-semibold">Sri Ram Medicals</div>
          <div className="text-xs text-muted">Seller</div>
        </div>
      </div>
    </aside>
  );
}
