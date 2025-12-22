"use client";

import { useMemo } from "react";

import type { FocusTreeNode } from "@/components/topics/hooks/useTopicTree";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Panel } from "@/components/ui/P5Panel";

type Props = {
  rootId: string;
  nodes: FocusTreeNode[];
  selectedId: string | null;
  onSelect: (argumentId: string) => void;
};

export function FocusView({ rootId, nodes, selectedId, onSelect }: Props) {
  const { root, childrenByParentId } = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rootNode = byId.get(rootId) ?? null;

    const children = new Map<string, FocusTreeNode[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const existing = children.get(node.parentId) ?? [];
      existing.push(node);
      children.set(node.parentId, existing);
    }

    return { root: rootNode, childrenByParentId: children };
  }, [nodes, rootId]);

  if (!root) {
    return (
      <P5Alert role="status" variant="warn" title="focus">
        Focus tree is unavailable.
      </P5Alert>
    );
  }

  const nodeBaseClass = [
    "w-full px-2 py-1.5 text-left text-sm",
    "border-[3px] border-[color:var(--ink)] shadow-[2px_2px_0_var(--ink)]",
    "transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5",
  ].join(" ");

  function renderNode(node: FocusTreeNode) {
    const children = childrenByParentId.get(node.id) ?? [];
    const selected = selectedId === node.id;

    return (
      <li key={node.id} className="space-y-1">
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-current={selected ? "true" : undefined}
          className={[
            nodeBaseClass,
            selected
              ? "bg-[color:var(--ink)] text-[color:var(--paper)] shadow-[var(--p5-shadow-rebel)]"
              : "bg-[color:var(--paper)] text-[color:var(--ink)] hover:bg-[color:var(--concrete-200)]",
          ].join(" ")}
          style={{
            clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
          }}
        >
          {node.label}
        </button>

        {children.length > 0 ? (
          <ul className="space-y-1 border-l-[3px] border-dashed border-[color:var(--ink)] pl-3">
            {children.map((child) => renderNode(child))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <P5Panel
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            Focus
          </h2>
          <div className="text-xs text-white/80">
            <span className="font-mono">Click</span> to select
          </div>
        </div>
      }
    >
      <ul className="space-y-2">{renderNode(root)}</ul>
    </P5Panel>
  );
}
