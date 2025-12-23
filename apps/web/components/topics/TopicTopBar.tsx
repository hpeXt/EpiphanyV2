"use client";

import Link from "next/link";
import { P5Badge } from "@/components/ui/P5Badge";

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
  const statusVariant =
    status === "active" ? "acid" : status === "frozen" ? "electric" : "ink";

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4">
      {/* 左侧 */}
      <div className="flex items-center gap-3">
        {showBackButton && (
          <Link
            href="/topics"
            className="flex h-8 w-8 items-center justify-center border-[3px] border-[color:var(--paper)] text-[color:var(--paper)] transition-transform hover:scale-110 hover:bg-[color:var(--paper)]/10"
            aria-label="返回议题列表"
          >
            ◀
          </Link>
        )}
        {/* 中间 - 标题 */}
        <h1
          className="max-w-[200px] truncate font-display text-lg uppercase tracking-wide text-[color:var(--paper)] sm:max-w-md"
          title={title}
        >
          {title}
        </h1>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-2">
        <P5Badge variant={statusVariant}>{status}</P5Badge>

        {reportButton}
        {claimButton}
        {manageButton}

        {balance !== null && (
          <div className="flex items-center gap-1 border-[3px] border-[color:var(--paper)] bg-transparent px-2 py-1 font-mono text-sm text-[color:var(--paper)]">
            <span>◆</span>
            <span>{balance}</span>
          </div>
        )}

        {identityFingerprint && (
          <Link
            href="/my"
            className="flex items-center gap-1 border-[3px] border-[color:var(--paper)] bg-transparent px-2 py-1 font-mono text-sm text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)]/10"
            title="我的身份"
          >
            <span className="flex gap-0.5">
              <span className="h-2 w-2 rounded-full bg-[color:var(--rebel-red)]" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--acid)]" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--electric)]" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--paper)]" />
            </span>
            <span className="hidden sm:inline">{identityFingerprint}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
