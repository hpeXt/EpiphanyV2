"use client";

import Link from "next/link";
import { P5LinkButton } from "@/components/ui/P5Button";

export function HomeTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4">
      {/* 空占位（保持居中） */}
      <div className="w-20" />

      {/* 中间留空（旭日图为主角） */}
      <div />

      {/* 右侧操作 */}
      <div className="flex items-center gap-2">
        <P5LinkButton
          href="/topics"
          size="sm"
          variant="ghost"
          className="border-[color:var(--paper)] bg-transparent text-[color:var(--paper)] hover:bg-[color:var(--paper)]/10"
        >
          列表
        </P5LinkButton>
        <P5LinkButton
          href="/my"
          size="sm"
          variant="ghost"
          className="border-[color:var(--paper)] bg-transparent text-[color:var(--paper)] hover:bg-[color:var(--paper)]/10"
        >
          My
        </P5LinkButton>
        <P5LinkButton href="/topics/new" size="sm" variant="primary">
          + 创建议题
        </P5LinkButton>
      </div>
    </header>
  );
}
