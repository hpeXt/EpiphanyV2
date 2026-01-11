"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useI18n } from "@/components/i18n/I18nProvider";
import { P5TopNav } from "@/components/ui/P5TopNav";
import { BRAND } from "@/lib/brand";

export function P5Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm"
      >
        {t("common.skipToContent")}
      </a>

      <header className="border-b border-border/50 bg-background">
        <div className="container flex items-center justify-between gap-4 py-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="text-2xl font-serif text-foreground/80">Σ</span>
            <span className="text-sm tracking-wide text-muted-foreground">
              {BRAND.nameUpper}
            </span>
          </Link>
          <P5TopNav />
        </div>
      </header>

      <main id="main" className="container flex min-h-0 flex-1 flex-col py-10">
        {children}
      </main>
    </div>
  );
}
