"use client";

import Link from "next/link";
import { P5LinkButton } from "@/components/ui/P5Button";

export function TopicsTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4">
      {/* Logo */}
      <Link
        href="/"
        className="font-display text-xl tracking-wider text-[color:var(--paper)]"
        style={{
          textShadow: "2px 2px 0 var(--rebel-red)",
        }}
      >
        TM
      </Link>

      {/* 中间标题 */}
      <h1 className="font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
        TOPICS
      </h1>

      {/* 右侧操作 */}
      <div className="flex items-center gap-2">
        <P5LinkButton
          href="/my"
          size="sm"
          variant="ghost"
          className="border-[color:var(--paper)] bg-transparent text-[color:var(--paper)] hover:bg-[color:var(--paper)]/10"
        >
          My
        </P5LinkButton>
        <P5LinkButton href="/topics/new" size="sm" variant="primary">
          + 创建
        </P5LinkButton>
      </div>
    </header>
  );
}
