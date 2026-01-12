"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import { P5Panel } from "@/components/ui/P5Panel";

function toggleCls(active: boolean) {
  return [
    "inline-flex items-center justify-center",
    "rounded-md px-3 py-2 text-sm font-medium",
    "transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    active
      ? "bg-[color:var(--ink)] text-[color:var(--paper)]"
      : "bg-transparent text-[color:var(--ink)] hover:bg-[color:var(--concrete-100)]",
  ].join(" ");
}

export function LanguageSettings() {
  const { locale, setLocale, t } = useI18n();

  return (
    <P5Panel
      header={
        <div className="bg-[color:var(--ink)] px-4 py-3 font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
          {t("nav.language")}
        </div>
      }
    >
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="space-y-1">
          <div className="font-display text-sm uppercase tracking-wide text-[color:var(--ink)]">
            {t("nav.language")}
          </div>
          <div className="text-sm text-muted-foreground">{t("my.languageHint")}</div>
        </div>

        <div
          className="flex items-center gap-1 rounded-md border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-1"
          aria-label={t("nav.language")}
        >
          <button
            type="button"
            className={toggleCls(locale === "zh")}
            aria-pressed={locale === "zh"}
            onClick={() => {
              if (locale !== "zh") setLocale("zh");
            }}
          >
            {t("nav.zh")}
          </button>
          <button
            type="button"
            className={toggleCls(locale === "en")}
            aria-pressed={locale === "en"}
            onClick={() => {
              if (locale !== "en") setLocale("en");
            }}
          >
            {t("nav.en")}
          </button>
        </div>
      </div>
    </P5Panel>
  );
}

