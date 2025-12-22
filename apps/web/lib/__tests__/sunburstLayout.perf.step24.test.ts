import { buildSunburstLayout } from "@/lib/visualization/sunburst/layout";

type SunburstNode = {
  id: string;
  label: string;
  value?: number;
  children?: SunburstNode[];
};

function generateBalancedTree(options: {
  depth: number;
  breadth: number;
}): { root: SunburstNode; nodeCount: number } {
  const { depth, breadth } = options;

  let nodeCount = 0;
  function makeNode(level: number): SunburstNode {
    nodeCount += 1;
    const id = `n-${nodeCount}`;

    if (level >= depth) {
      return { id, label: id, value: 1 };
    }

    return {
      id,
      label: id,
      children: Array.from({ length: breadth }, () => makeNode(level + 1)),
    };
  }

  return { root: makeNode(0), nodeCount };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] ?? 0;
}

describe("Sunburst layout perf (Step 24)", () => {
  it("buildSunburstLayout stays under baseline threshold", () => {
    const { root, nodeCount } = generateBalancedTree({ depth: 7, breadth: 4 }); // ~21k nodes

    // Warm-up (JIT)
    const warm = buildSunburstLayout(root, { startAngle: 0, endAngle: Math.PI * 2 });
    expect(warm.nodes.length).toBe(nodeCount);

    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      const result = buildSunburstLayout(root, { startAngle: 0, endAngle: Math.PI * 2 });
      const t1 = performance.now();
      expect(result.nodes.length).toBe(nodeCount);
      samples.push(t1 - t0);
    }

    const p50 = median(samples);
    expect(p50).toBeLessThan(200);
  });
});

