import hi from "@/locales/hi";
import kn from "@/locales/kn";
import ta from "@/locales/ta";
import te from "@/locales/te";

// Dashboard language. Every text on screen is written in English and passed through t(); the English text is
// the key into each language file in src/locales, and anything not translated yet shows in English.
// To add a language: add src/locales/<code>.ts (copy hi.ts) and list it here.

export const UI_LANGS = {
  en: { name: "English", dict: {} as Record<string, string> },
  hi: { name: "हिन्दी", dict: hi },
  kn: { name: "ಕನ್ನಡ", dict: kn },
  ta: { name: "தமிழ்", dict: ta },
  te: { name: "తెలుగు", dict: te },
};
export type UiLang = keyof typeof UI_LANGS;
export const UI_LANG_COOKIE = "ui_lang";

export const isUiLang = (v: string | undefined | null): v is UiLang => !!v && v in UI_LANGS;

/** "{n} orders" with { n: 3 } -> "3 orders", in the chosen language. */
export function translate(lang: UiLang, text: string, vars?: Record<string, string | number>) {
  const out = UI_LANGS[lang]?.dict[text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

export type T = (text: string, vars?: Record<string, string | number>) => string;
export const makeT = (lang: UiLang): T => (text, vars) => translate(lang, text, vars);
