import type { SunburstNode } from "@/lib/visualization/sunburst/layout";

export type FlatTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  value?: number;
};

export function buildSunburstTreeFromFlatNodes(
  nodes: FlatTreeNode[],
  rootId: string,
): SunburstNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(rootId)) return null;

  const childrenByParentId = new Map<string, FlatTreeNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const existing = childrenByParentId.get(node.parentId) ?? [];
    existing.push(node);
    childrenByParentId.set(node.parentId, existing);
  }

  const path = new Set<string>();

  const buildNode = (id: string): SunburstNode => {
    const flat = byId.get(id);
    const label = flat?.label ?? id;

    if (path.has(id)) {
      return { id, label, value: flat?.value, children: [] };
    }

    path.add(id);
    const children = (childrenByParentId.get(id) ?? []).map((child) => buildNode(child.id));
    path.delete(id);

    return {
      id,
      label,
      value: flat?.value,
      children,
    };
  };

  return buildNode(rootId);
}

