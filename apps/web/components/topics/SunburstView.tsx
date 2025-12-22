"use client";

import { useMemo } from "react";

import type { FocusTreeNode } from "@/components/topics/hooks/useTopicTree";
import { Sunburst } from "@/components/visualizations/Sunburst";
import { buildSunburstTreeFromFlatNodes } from "@/lib/visualization/sunburst/adapters";

type Props = {
  rootId: string;
  nodes: FocusTreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function SunburstView({ rootId, nodes, selectedId, onSelect }: Props) {
  const tree = useMemo(() => buildSunburstTreeFromFlatNodes(nodes, rootId), [nodes, rootId]);

  if (!tree) {
    return (
      <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        Sunburst overview is unavailable.
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-700">Overview</h2>
        <div className="text-xs text-zinc-600">
          <span className="font-mono">Hover</span> for details ·{" "}
          <span className="font-mono">Click</span> to select
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200 bg-[color:var(--concrete-200)] p-3">
        <Sunburst
          tree={tree}
          width={520}
          height={520}
          padAngle={0.006}
          interactive
          showTooltip
          selectedId={selectedId}
          onSelectedIdChange={onSelect}
        />
      </div>
    </section>
  );
}

