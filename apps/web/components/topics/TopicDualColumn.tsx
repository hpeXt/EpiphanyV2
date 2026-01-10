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
      <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm md:flex">
        {/* 左栏 */}
        <div className="relative flex w-[55%] min-w-[360px] flex-col overflow-auto border-r border-border/60 bg-background p-4">
          {left}
        </div>

        {/* 右栏 */}
        <div className="flex w-[45%] flex-col overflow-hidden bg-background">
          {right}
        </div>
      </div>

      {/* 移动端：单栏切换 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm md:hidden">
        {/* 切换 Tabs */}
        <div className="flex-shrink-0 border-b border-border/60 bg-background p-2">
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
            <div className="h-full bg-background p-4">{left}</div>
          ) : (
            <div className="h-full bg-background">{right}</div>
          )}
        </div>
      </div>
    </>
  );
}
