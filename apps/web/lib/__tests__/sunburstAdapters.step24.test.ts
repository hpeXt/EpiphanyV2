import { buildSunburstTreeFromFlatNodes } from "@/lib/visualization/sunburst/adapters";

describe("Sunburst adapters (Step 24)", () => {
  it("builds a hierarchical tree from flat nodes", () => {
    const nodes = [
      { id: "root", parentId: null, label: "Root" },
      { id: "a", parentId: "root", label: "A" },
      { id: "a1", parentId: "a", label: "A1" },
      { id: "a2", parentId: "a", label: "A2" },
      { id: "b", parentId: "root", label: "B" },
    ];

    const tree = buildSunburstTreeFromFlatNodes(nodes, "root");

    expect(tree?.id).toBe("root");
    expect(tree?.children?.map((child) => child.id)).toEqual(["a", "b"]);
    expect(tree?.children?.[0]?.children?.map((child) => child.id)).toEqual(["a1", "a2"]);
  });

  it("returns null when root is missing", () => {
    const nodes = [{ id: "a", parentId: null, label: "A" }];
    expect(buildSunburstTreeFromFlatNodes(nodes, "root")).toBeNull();
  });
});

