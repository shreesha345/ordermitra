import { cache } from "react";
import { cookies } from "next/headers";
import { isUiLang, makeT, UI_LANG_COOKIE, type UiLang } from "./ui-lang";

/** The dashboard language: the viewer's choice, else DASHBOARD_LANGUAGE from .env, else English. */
export const uiLang = cache(async (): Promise<UiLang> => {
  const chosen = (await cookies()).get(UI_LANG_COOKIE)?.value;
  if (isUiLang(chosen)) return chosen;
  const env = process.env.DASHBOARD_LANGUAGE;
  return isUiLang(env) ? env : "en";
});

/** t() for server components. Call inside a Suspense boundary (it reads a cookie). */
export const getT = cache(async () => makeT(await uiLang()));
