import { fireEvent, render, screen } from "@testing-library/react";

const { Sunburst } = require("@/components/visualizations/Sunburst");

type SunburstNode = {
  id: string;
  label: string;
  value?: number;
  children?: SunburstNode[];
};

function createTreeFixture(): SunburstNode {
  return {
    id: "root",
    label: "Root",
    children: [
      {
        id: "a",
        label: "A",
        children: [
          { id: "a1", label: "A1", value: 1 },
          { id: "a2", label: "A2", value: 2 },
        ],
      },
      { id: "b", label: "B", value: 1 },
    ],
  };
}

function readSegments() {
  return screen.getAllByTestId("sunburst-segment").map((segment) => ({
    id: segment.getAttribute("data-nodeid"),
    d: segment.getAttribute("d"),
    selected: segment.getAttribute("data-selected"),
  }));
}

function getSegmentById(id: string) {
  return screen
    .getAllByTestId("sunburst-segment")
    .find((segment) => segment.getAttribute("data-nodeid") === id);
}

describe("Sunburst (Step 24)", () => {
  it("renders segments consistently for the same props", () => {
    const tree = createTreeFixture();

    const { rerender } = render(
      <Sunburst tree={tree} width={320} height={320} padAngle={0} />,
    );

    expect(screen.getByTestId("sunburst-svg")).toBeInTheDocument();
    expect(screen.getByTestId("sunburst-root")).toBeInTheDocument();
    expect(screen.getAllByTestId("sunburst-segment")).toHaveLength(4);

    const first = readSegments();
    rerender(<Sunburst tree={tree} width={320} height={320} padAngle={0} />);
    const second = readSegments();

    expect(second).toEqual(first);
  });

  it("applies selectedId deterministically", () => {
    const tree = createTreeFixture();

    render(<Sunburst tree={tree} width={320} height={320} padAngle={0} selectedId="a2" />);

    const segments = readSegments();
    const selected = segments.find((segment) => segment.id === "a2");
    expect(selected?.selected).toBe("true");
  });

  it("supports hover tooltip + click selection when interactive", async () => {
    const tree = createTreeFixture();
    const onNodeClick = jest.fn();

    render(
      <Sunburst
        tree={tree}
        width={320}
        height={320}
        padAngle={0}
        interactive
        showTooltip
        onNodeClick={onNodeClick}
      />,
    );

    const container = screen.getByTestId("sunburst-container");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 320,
        height: 320,
        right: 320,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    const segment = getSegmentById("a2");
    expect(segment).toBeTruthy();

    fireEvent.pointerMove(segment!, { clientX: 160, clientY: 80 });
    expect(await screen.findByTestId("sunburst-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("sunburst-tooltip-title")).toHaveTextContent("A2");

    fireEvent.click(segment!);

    const selected = getSegmentById("a2");
    expect(selected).toHaveAttribute("data-selected", "true");
    expect(onNodeClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a2", label: "A2" }),
    );
  });
});
