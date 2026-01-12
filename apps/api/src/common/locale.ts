/**
 * @file locale.ts
 * @description Minimal locale utilities for zh/en content localization.
 */

export type Locale = 'zh' | 'en';

export const DEFAULT_LOCALE: Locale = 'zh';

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}

export function resolveRequestLocale(params: {
  localeHeader?: string;
  acceptLanguage?: string;
}): Locale {
  if (params.localeHeader && isLocale(params.localeHeader)) return params.localeHeader;

  const acceptLanguage = params.acceptLanguage?.trim();
  if (!acceptLanguage) return DEFAULT_LOCALE;

  // Very small parser: look at the first language-range only.
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('zh')) return 'zh';
  if (first.startsWith('en')) return 'en';

  return DEFAULT_LOCALE;
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'zh' ? 'en' : 'zh';
}

