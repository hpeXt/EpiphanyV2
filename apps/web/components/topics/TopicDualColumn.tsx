"use client";

import { useState, type ReactNode } from "react";
import { P5Tabs } from "@/components/ui/P5Tabs";

type Props = {
  left: ReactNode;
  right: ReactNode;
};

export function TopicDualColumn({ left, right }: Props) {
  const [mobileView, setMobileView] = useState<"viz" | "chat">("viz");

  return (
    <>
      {/* 桌面端：双栏 */}
      <div className="hidden h-[calc(100vh-56px)] overflow-hidden md:flex">
        {/* 左栏 - 60% */}
        <div className="relative flex w-[60%] flex-col overflow-auto bg-[color:var(--concrete-300)] p-4">
          {left}
        </div>

        {/* 对角撕裂分隔线 */}
        <div
          className="w-2 flex-shrink-0"
          style={{
            background: `
              linear-gradient(135deg, var(--ink) 25%, transparent 25%),
              linear-gradient(-135deg, var(--ink) 25%, transparent 25%)
            `,
            backgroundSize: "8px 8px",
            backgroundColor: "var(--concrete-200)",
          }}
          aria-hidden="true"
        />

        {/* 右栏 - 40% */}
        <div className="flex w-[40%] flex-col overflow-hidden bg-[color:var(--paper)]">
          {right}
        </div>
      </div>

      {/* 移动端：单栏切换 */}
      <div className="flex h-[calc(100vh-56px)] flex-col md:hidden">
        {/* 切换 Tabs */}
        <div className="flex-shrink-0 border-b-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-2">
          <P5Tabs
            ariaLabel="移动端视图切换"
            value={mobileView}
            onValueChange={(v) => setMobileView(v as "viz" | "chat")}
            tabs={[
              { value: "viz", label: "可视化" },
              { value: "chat", label: "对话" },
            ]}
          />
        </div>

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-auto">
          {mobileView === "viz" ? (
            <div className="h-full bg-[color:var(--concrete-300)] p-4">{left}</div>
          ) : (
            <div className="h-full bg-[color:var(--paper)]">{right}</div>
          )}
        </div>
      </div>
    </>
  );
}
