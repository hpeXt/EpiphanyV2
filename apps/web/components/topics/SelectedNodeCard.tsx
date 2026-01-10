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
      <div className="rounded-lg border border-border/60 bg-muted/40 p-8 text-center text-muted-foreground">
        <div className="mb-2 text-2xl">◎</div>
        <div className="text-sm">点击左侧节点查看详情</div>
      </div>
    );
  }

  const stance = getStanceFromScore(node.stanceScore);
  const stanceColor = STANCE_COLORS[stance];

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-sm"
    >
      {/* Stance 色条 */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: stanceColor }}
      />

      {/* 内容 */}
      <div className="p-4 pt-5">
        {/* 正文 */}
        <div className="mb-4 line-clamp-4 text-sm leading-relaxed text-foreground">
          {node.bodyRich ? (
            <TiptapRenderer doc={node.bodyRich} />
          ) : (
            <p>{node.body}</p>
          )}
        </div>

        {/* 元信息 */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {/* Stance */}
          <span
            className="rounded-full border border-border px-2 py-0.5 font-medium"
            style={{
              backgroundColor: stanceColor,
              color: stance === "neutral" ? "var(--foreground)" : "var(--background)",
            }}
          >
            {stance}
          </span>

          {/* 票数 */}
          <span className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-foreground">
            ●{node.totalVotes}
          </span>

          {/* 作者 */}
          <span className="font-mono">
            {node.authorId.slice(0, 6)}...
          </span>

          {/* AI 分析状态 */}
          {node.analysisStatus && node.analysisStatus !== "ready" && (
            <span className="flex items-center gap-1 text-accent">
              AI: {node.analysisStatus === "pending_analysis" ? "⏳" : "▶"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
