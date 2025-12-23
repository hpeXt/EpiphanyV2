"use client";

import type { Argument } from "@epiphany/shared-contracts";
import { TiptapRenderer } from "@/components/ui/TiptapRenderer";

type Props = {
  node: Argument | null;
};

type StanceType = "pro" | "con" | "neutral";

const STANCE_COLORS: Record<StanceType, string> = {
  pro: "var(--electric)",
  con: "var(--rebel-red)",
  neutral: "var(--acid)",
};

function getStanceFromScore(score: number | null): StanceType {
  if (score === null) return "neutral";
  if (score > 0.3) return "pro";
  if (score < -0.3) return "con";
  return "neutral";
}

export function SelectedNodeCard({ node }: Props) {
  if (!node) {
    return (
      <div className="border-[4px] border-[color:var(--ink)] bg-[color:var(--concrete-200)] p-6 text-center text-[color:var(--ink)]/60">
        <div className="mb-2 text-2xl">◎</div>
        <div className="font-display text-sm uppercase">点击左侧节点查看详情</div>
      </div>
    );
  }

  const stance = getStanceFromScore(node.stanceScore);
  const stanceColor = STANCE_COLORS[stance];

  return (
    <div
      className="
        relative
        -rotate-[0.5deg]
        border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)]
        shadow-[4px_4px_0_var(--rebel-red),8px_8px_0_var(--ink)]
        transition-all duration-[var(--p5-motion-fast)]
        animate-pop
      "
    >
      {/* Stance 色条 */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: stanceColor }}
      />

      {/* 内容 */}
      <div className="p-4 pt-5">
        {/* 正文 */}
        <div className="mb-4 line-clamp-4 text-sm leading-relaxed text-[color:var(--ink)]">
          {node.bodyRich ? (
            <TiptapRenderer doc={node.bodyRich} />
          ) : (
            <p>{node.body}</p>
          )}
        </div>

        {/* 元信息 */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Stance */}
          <span
            className="border-[2px] border-[color:var(--ink)] px-2 py-0.5 font-display uppercase"
            style={{
              backgroundColor: stanceColor,
              color: stance === "neutral" ? "var(--ink)" : "var(--paper)",
            }}
          >
            {stance}
          </span>

          {/* 票数 */}
          <span className="flex items-center gap-1 border-[2px] border-[color:var(--ink)] bg-[color:var(--paper)] px-2 py-0.5 font-mono">
            ●{node.totalVotes}
          </span>

          {/* 作者 */}
          <span className="font-mono text-[color:var(--ink)]/60">
            {node.authorId.slice(0, 6)}...
          </span>

          {/* AI 分析状态 */}
          {node.analysisStatus && node.analysisStatus !== "ready" && (
            <span className="flex items-center gap-1 text-[color:var(--electric)]">
              AI: {node.analysisStatus === "pending_analysis" ? "⏳" : "▶"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
