"use client";

import { useMemo } from "react";

import type { FocusTreeNode } from "@/components/topics/hooks/useTopicTree";

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
      <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        Focus tree is unavailable.
      </div>
    );
  }

  function renderNode(node: FocusTreeNode) {
    const children = childrenByParentId.get(node.id) ?? [];

    return (
      <li key={node.id} className="space-y-1">
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-current={selectedId === node.id ? "true" : undefined}
          className={[
            "w-full rounded-md px-2 py-1 text-left text-sm",
            selectedId === node.id
              ? "bg-zinc-900 text-white"
              : "hover:bg-zinc-100",
          ].join(" ")}
        >
          {node.label}
        </button>

        {children.length > 0 ? (
          <ul className="space-y-1 border-l border-zinc-200 pl-3">
            {children.map((child) => renderNode(child))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-zinc-700">Focus</h2>
      <ul className="space-y-2">{renderNode(root)}</ul>
    </section>
  );
}

