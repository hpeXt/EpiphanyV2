export type SunburstNode = {
  id: string;
  label: string;
  value?: number;
  children?: SunburstNode[];
};

export type SunburstLayoutNode = {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  /**
   * Subtree value used for angular allocation (leaf value if leaf).
   */
  value: number;
  startAngle: number;
  endAngle: number;
  childIds: string[];
};

export type SunburstLayout = {
  rootId: string;
  totalValue: number;
  startAngle: number;
  endAngle: number;
  maxDepth: number;
  nodes: SunburstLayoutNode[];
};

export type SunburstLayoutOptions = {
  startAngle?: number;
  endAngle?: number;
};

type InternalNode = {
  id: string;
  label: string;
  parentIndex: number | null;
  depth: number;
  leafValue: number;
  children: number[];
};

function toFiniteNonNegativeNumber(value: unknown, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  return value;
}

export function buildSunburstLayout(root: SunburstNode, options?: SunburstLayoutOptions): SunburstLayout {
  const startAngle = options?.startAngle ?? 0;
  const endAngle = options?.endAngle ?? Math.PI * 2;

  const internal: InternalNode[] = [];

  const stack: Array<{ node: SunburstNode; parentIndex: number | null; depth: number }> = [
    { node: root, parentIndex: null, depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    const node = current.node;
    const children = Array.isArray(node.children) ? node.children : [];

    const index = internal.length;
    internal.push({
      id: String(node.id),
      label: String(node.label),
      parentIndex: current.parentIndex,
      depth: current.depth,
      leafValue: toFiniteNonNegativeNumber(node.value, 1),
      children: [],
    });

    if (current.parentIndex !== null) {
      internal[current.parentIndex]?.children.push(index);
    }

    // Preserve original order for deterministic rendering.
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (!child) continue;
      stack.push({ node: child, parentIndex: index, depth: current.depth + 1 });
    }
  }

  const subtreeValue = new Array<number>(internal.length).fill(0);
  for (let i = internal.length - 1; i >= 0; i -= 1) {
    const node = internal[i];
    if (!node) continue;
    if (node.children.length === 0) {
      subtreeValue[i] = node.leafValue;
      continue;
    }
    let sum = 0;
    for (const childIndex of node.children) {
      sum += subtreeValue[childIndex] ?? 0;
    }
    subtreeValue[i] = sum;
  }

  const nodeStartAngle = new Array<number>(internal.length).fill(startAngle);
  const nodeEndAngle = new Array<number>(internal.length).fill(startAngle);
  nodeStartAngle[0] = startAngle;
  nodeEndAngle[0] = endAngle;

  const allocationStack = [0];
  while (allocationStack.length > 0) {
    const index = allocationStack.pop();
    if (index === undefined) break;
    const node = internal[index];
    if (!node) continue;
    if (node.children.length === 0) continue;

    const span = (nodeEndAngle[index] ?? startAngle) - (nodeStartAngle[index] ?? startAngle);
    let total = 0;
    for (const childIndex of node.children) {
      total += subtreeValue[childIndex] ?? 0;
    }

    let cursor = nodeStartAngle[index] ?? startAngle;
    for (const childIndex of node.children) {
      const childValue = subtreeValue[childIndex] ?? 0;
      const fraction = total > 0 ? childValue / total : 0;
      const childSpan = span * fraction;

      nodeStartAngle[childIndex] = cursor;
      nodeEndAngle[childIndex] = cursor + childSpan;
      cursor += childSpan;

      allocationStack.push(childIndex);
    }
  }

  let maxDepth = 0;
  const nodes: SunburstLayoutNode[] = internal.map((node, index) => {
    maxDepth = Math.max(maxDepth, node.depth);

    const parentId = node.parentIndex === null ? null : internal[node.parentIndex]?.id ?? null;
    const childIds = node.children.map((childIndex) => internal[childIndex]?.id ?? "").filter(Boolean);

    return {
      id: node.id,
      label: node.label,
      parentId,
      depth: node.depth,
      value: subtreeValue[index] ?? 0,
      startAngle: nodeStartAngle[index] ?? startAngle,
      endAngle: nodeEndAngle[index] ?? startAngle,
      childIds,
    };
  });

  return {
    rootId: nodes[0]?.id ?? String(root.id),
    totalValue: subtreeValue[0] ?? 0,
    startAngle,
    endAngle,
    maxDepth,
    nodes,
  };
}

