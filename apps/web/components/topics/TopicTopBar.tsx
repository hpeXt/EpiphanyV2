"use client";

import Link from "next/link";
import { P5Badge } from "@/components/ui/P5Badge";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  title: string;
  status: "active" | "frozen" | "archived";
  balance: number | null;
  identityFingerprint: string | null;
  showBackButton?: boolean;
  claimButton?: React.ReactNode;
  manageButton?: React.ReactNode;
  reportButton?: React.ReactNode;
};

export function TopicTopBar({
  title,
  status,
  balance,
  identityFingerprint,
  showBackButton = false,
  claimButton,
  manageButton,
  reportButton,
}: Props) {
  const { t } = useI18n();
  const displayTitle = title.trim() ? title : t("topics.untitled");
  const statusVariant =
    status === "active" ? "electric" : status === "frozen" ? "acid" : "ink";

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-card-foreground shadow-sm">
      {/* 左侧 */}
      <div className="flex min-w-0 items-center gap-3">
        {showBackButton ? (
          <Link
            href="/topics"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={t("topics.backToList")}
          >
            ←
          </Link>
        ) : null}

        <h1 className="min-w-0 truncate font-serif text-xl font-semibold text-foreground" title={displayTitle}>
          {displayTitle}
        </h1>

        <P5Badge variant={statusVariant}>{t(`status.${status}`)}</P5Badge>
      </div>

      {/* 右侧 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {reportButton}
        {claimButton}
        {manageButton}

        {balance !== null ? (
          <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground shadow-sm">
            <span>◆</span>
            <span>{balance}</span>
          </div>
        ) : null}

        {identityFingerprint ? (
          <Link
            href="/my"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title={t("identity.myIdentity")}
          >
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--chart-2)]" />
              <span className="h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="hidden sm:inline">{t("my.identityReady")}</span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}
