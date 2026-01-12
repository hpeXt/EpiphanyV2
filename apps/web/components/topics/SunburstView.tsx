"use client";

import { useMemo } from "react";

import type { FocusTreeNode } from "@/components/topics/hooks/useTopicTree";
import { Sunburst } from "@/components/visualizations/Sunburst";
import { buildSunburstTreeFromFlatNodes } from "@/lib/visualization/sunburst/adapters";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Panel } from "@/components/ui/P5Panel";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  rootId: string;
  nodes: FocusTreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function SunburstView({ rootId, nodes, selectedId, onSelect }: Props) {
  const { t } = useI18n();
  const tree = useMemo(() => buildSunburstTreeFromFlatNodes(nodes, rootId), [nodes, rootId]);

  if (!tree) {
    return (
      <P5Alert role="status" variant="warn" title={t("topic.viewMode.overview")}>
        {t("sunburstView.unavailable")}
      </P5Alert>
    );
  }

  return (
    <P5Panel
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            {t("topic.viewMode.overview")}
          </h2>
          <div className="text-xs text-white/80">
            {t("sunburstView.instructions")}
          </div>
        </div>
      }
    >
      <div
        className="overflow-hidden border-[3px] border-[color:var(--ink)] bg-[color:var(--concrete-200)] p-3 shadow-[2px_2px_0_var(--ink)]"
        onClick={() => onSelect(null)}
        style={{
          clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)",
        }}
      >
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
    </P5Panel>
  );
}
