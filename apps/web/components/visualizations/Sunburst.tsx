"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { buildSunburstLayout, type SunburstNode } from "@/lib/visualization/sunburst/layout";
import { CallingCard } from "@/components/ui/CallingCard";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  tree: SunburstNode;
  width?: number;
  height?: number;
  padAngle?: number;
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  interactive?: boolean;
  showTooltip?: boolean;
  onSelectedIdChange?: (id: string | null) => void;
  onNodeClick?: (node: { id: string; label: string; depth: number; parentId: string | null; value: number; childCount: number }) => void;
  onHoverChange?: (value: { id: string; pointer: PointerPosition } | null) => void;
};

type ArcSpec = {
  id: string;
  label: string;
  depth: number;
  parentId: string | null;
  value: number;
  childCount: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function polarToCartesian(radius: number, angle: number) {
  const a = angle - Math.PI / 2;
  return {
    x: round(radius * Math.cos(a)),
    y: round(radius * Math.sin(a)),
  };
}

function arcPath(input: {
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  padAngle: number;
}): string | null {
  const span = input.endAngle - input.startAngle;
  if (!Number.isFinite(span) || span <= 0) return null;

  const pad = clamp(input.padAngle, 0, span / 2);
  const startAngle = input.startAngle + pad / 2;
  const endAngle = input.endAngle - pad / 2;
  if (endAngle <= startAngle) return null;

  const innerRadius = Math.max(0, input.innerRadius);
  const outerRadius = Math.max(innerRadius, input.outerRadius);

  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  const p0 = polarToCartesian(outerRadius, startAngle);
  const p1 = polarToCartesian(outerRadius, endAngle);

  if (innerRadius <= 0.001) {
    return [
      `M ${p0.x} ${p0.y}`,
      `A ${round(outerRadius)} ${round(outerRadius)} 0 ${largeArcFlag} 1 ${p1.x} ${p1.y}`,
      "L 0 0",
      "Z",
    ].join(" ");
  }

  const p2 = polarToCartesian(innerRadius, endAngle);
  const p3 = polarToCartesian(innerRadius, startAngle);

  return [
    `M ${p0.x} ${p0.y}`,
    `A ${round(outerRadius)} ${round(outerRadius)} 0 ${largeArcFlag} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${round(innerRadius)} ${round(innerRadius)} 0 ${largeArcFlag} 0 ${p3.x} ${p3.y}`,
    "Z",
  ].join(" ");
}

function segmentFill(depth: number) {
  const palette = ["var(--paper)", "var(--concrete-200)", "var(--concrete-100)"];
  return palette[depth % palette.length] ?? "var(--paper)";
}

type PointerPosition = { x: number; y: number };

export function Sunburst({
  tree,
  width = 420,
  height = 420,
  padAngle = 0.004,
  selectedId,
  defaultSelectedId = null,
  interactive = false,
  showTooltip = false,
  onSelectedIdChange,
  onNodeClick,
  onHoverChange,
}: Props) {
  const { t } = useI18n();
  const layout = useMemo(() => buildSunburstLayout(tree, { startAngle: 0, endAngle: Math.PI * 2 }), [tree]);

  const radius = Math.max(8, Math.min(width, height) / 2 - 6);
  const ring = layout.maxDepth > 0 ? radius / (layout.maxDepth + 1) : radius;

  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState<string | null>(defaultSelectedId);
  const resolvedSelectedId = selectedId !== undefined ? selectedId : uncontrolledSelectedId;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverPointer, setHoverPointer] = useState<PointerPosition | null>(null);

  const arcs: ArcSpec[] = useMemo(() => {
    return layout.nodes
      .filter((node) => node.depth > 0)
      .map((node) => ({
        id: node.id,
        label: node.label,
        depth: node.depth,
        parentId: node.parentId,
        value: node.value,
        childCount: node.childIds.length,
        startAngle: node.startAngle,
        endAngle: node.endAngle,
        innerRadius: node.depth * ring,
        outerRadius: (node.depth + 1) * ring,
      }));
  }, [layout.nodes, ring]);

  const arcById = useMemo(() => {
    return new Map(arcs.map((arc) => [arc.id, arc]));
  }, [arcs]);

  const clearHover = useCallback(() => {
    setHoveredId(null);
    setHoverPointer(null);
    onHoverChange?.(null);
  }, [onHoverChange]);

  const handlePointerMove = useCallback(
    (arcId: string, event: ReactPointerEvent<SVGPathElement>) => {
      if (!interactive) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const pointer = rect
        ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
        : { x: event.clientX, y: event.clientY };
      setHoveredId(arcId);
      setHoverPointer(pointer);
      onHoverChange?.({ id: arcId, pointer });
    },
    [interactive, onHoverChange],
  );

  const handleClick = useCallback(
    (arcId: string) => {
      if (!interactive) return;
      const arc = arcById.get(arcId);
      if (!arc) return;

      const nextSelectedId = resolvedSelectedId === arcId ? null : arcId;
      if (selectedId === undefined) {
        setUncontrolledSelectedId(nextSelectedId);
      }
      onSelectedIdChange?.(nextSelectedId);
      onNodeClick?.({
        id: arc.id,
        label: arc.label,
        depth: arc.depth,
        parentId: arc.parentId,
        value: arc.value,
        childCount: arc.childCount,
      });
    },
    [arcById, interactive, onNodeClick, onSelectedIdChange, resolvedSelectedId, selectedId],
  );

  const handleBackgroundClick = useCallback((event: ReactMouseEvent) => {
    if (!interactive) return;

    event.stopPropagation();
    clearHover();
    if (selectedId === undefined) {
      setUncontrolledSelectedId(null);
    }
    onSelectedIdChange?.(null);
  }, [clearHover, interactive, onSelectedIdChange, selectedId]);

  const tooltipArc = hoveredId ? arcById.get(hoveredId) ?? null : null;

  return (
    <div
      ref={containerRef}
      data-testid="sunburst-container"
      className="relative w-full max-w-full"
      style={{ width, height }}
      onPointerLeave={interactive ? clearHover : undefined}
      onClick={interactive ? handleBackgroundClick : undefined}
    >
      <svg
        data-testid="sunburst-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("sunburst.ariaLabel")}
        className="block max-w-full"
      >
        <g transform={`translate(${width / 2} ${height / 2})`}>
          <circle
            data-testid="sunburst-root"
            r={ring}
            fill="var(--paper)"
            stroke="var(--ink)"
            strokeWidth={4}
          />

          {arcs.map((arc) => {
            const d = arcPath({
              innerRadius: arc.innerRadius,
              outerRadius: arc.outerRadius,
              startAngle: arc.startAngle,
              endAngle: arc.endAngle,
              padAngle,
            });
            if (!d) return null;
            const isSelected = resolvedSelectedId === arc.id;

            return (
              <path
                key={arc.id}
                data-testid="sunburst-segment"
                data-nodeid={arc.id}
                data-selected={isSelected ? "true" : undefined}
                d={d}
                fill={segmentFill(arc.depth)}
                stroke="var(--ink)"
                strokeWidth={3}
                onPointerMove={interactive ? (event) => handlePointerMove(arc.id, event) : undefined}
                onClick={
                  interactive
                    ? (event) => {
                        event.stopPropagation();
                        handleClick(arc.id);
                      }
                    : undefined
                }
                className={interactive ? "cursor-pointer" : undefined}
              />
            );
          })}
        </g>
      </svg>

      {interactive && showTooltip && tooltipArc && hoverPointer ? (
        <div
          data-testid="sunburst-tooltip"
          className="pointer-events-none absolute left-0 top-0 z-10"
          style={{
            left: clamp(
              hoverPointer.x + 14,
              12,
              Math.max(12, width - 260),
            ),
            top: clamp(
              hoverPointer.y + 14,
              12,
              Math.max(12, height - 160),
            ),
          }}
        >
          <CallingCard title={tooltipArc.label} titleTestId="sunburst-tooltip-title">
            <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 font-mono">
              <dt className="text-zinc-500">{t("sunburst.tooltip.depth")}</dt>
              <dd className="text-zinc-900">{tooltipArc.depth}</dd>
              <dt className="text-zinc-500">{t("sunburst.tooltip.children")}</dt>
              <dd className="text-zinc-900">{tooltipArc.childCount}</dd>
            </dl>
          </CallingCard>
        </div>
      ) : null}
    </div>
  );
}
