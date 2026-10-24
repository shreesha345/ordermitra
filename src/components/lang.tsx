"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { makeT, UI_LANG_COOKIE, UI_LANGS, type UiLang } from "@/lib/ui-lang";

const LangContext = createContext<UiLang>("en");

export function LangProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** t() for client components. */
export function useT() {
  const lang = useContext(LangContext);
  return useMemo(() => makeT(lang), [lang]);
}

export function useLang() {
  return useContext(LangContext);
}

/** Dashboard language picker; remembered in a cookie for a year. */
export function LangSwitch() {
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
      <Languages className="size-4 text-muted" aria-hidden />
      <span className="sr-only">{t("Dashboard language")}</span>
      <select
        value={lang}
        onChange={(e) => {
          document.cookie = `${UI_LANG_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium focus:outline-none"
      >
        {Object.entries(UI_LANGS).map(([code, l]) => (
          <option key={code} value={code}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
