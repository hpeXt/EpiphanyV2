"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  createTranslator,
  defaultLocale,
  isLocale,
  LOCALE_COOKIE_NAME,
  toHtmlLang,
  type Locale,
} from "@/lib/i18n";

type I18nContextValue = {
  locale: Locale;
  t: ReturnType<typeof createTranslator>;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);
const fallbackT = createTranslator(defaultLocale);
const fallbackSetLocale = () => {};

export function I18nProvider(props: { initialLocale?: string; children: ReactNode }) {
  const router = useRouter();

  const [locale, setLocaleState] = useState<Locale>(() => {
    return isLocale(props.initialLocale) ? props.initialLocale : defaultLocale;
  });

  const t = useMemo(() => createTranslator(locale), [locale]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  };

  useEffect(() => {
    document.documentElement.lang = toHtmlLang(locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t]);

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;

  return {
    locale: defaultLocale,
    t: fallbackT,
    setLocale: fallbackSetLocale,
  };
}
