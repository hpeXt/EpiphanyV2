import "server-only";

import { cookies } from "next/headers";

import { defaultLocale, isLocale, LOCALE_COOKIE_NAME, type Locale } from "@/lib/i18n";

export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE_NAME)?.value;
  return isLocale(raw) ? raw : defaultLocale;
}
