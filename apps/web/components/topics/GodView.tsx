"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Argument, ClusterMap, ClusterMapPoint } from "@epiphany/shared-contracts";

import { useClusterMap } from "@/components/topics/hooks/useClusterMap";
import { apiClient } from "@/lib/apiClient";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Panel } from "@/components/ui/P5Panel";

type Props = {
  topicId: string;
  refreshToken?: number;
};

type Viewport = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
};

type HoverState = {
  point: ClusterMapPoint;
  pointerX: number;
  pointerY: number;
};

const COLORS = {
  ink: "#1A1A1D",
  paper: "#FFFFFF",
  concrete: "#C9C9C9",
  pro: "#2563EB",
  con: "#FF0033",
  neutral: "#FACC15",
} as const;

export function GodView({ topicId, refreshToken = 0 }: Props) {
  const clusterMap = useClusterMap(topicId, refreshToken);

  if (clusterMap.status === "loading") {
    return <p className="text-sm text-[color:var(--ink)]/80">Loading semantic map…</p>;
  }

  if (clusterMap.status === "error") {
    return (
      <P5Alert role="alert" variant="error" title="error">
        {clusterMap.errorMessage}
      </P5Alert>
    );
  }

  if (clusterMap.data.points.length === 0) {
    return (
      <P5Alert role="status" variant="info" title="god view">
        No cluster map available yet.
      </P5Alert>
    );
  }

  return <ClusterMapCanvas map={clusterMap.data} />;
}

function ClusterMapCanvas({ map }: { map: ClusterMap }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const argumentCacheRef = useRef<Map<string, Argument>>(new Map());
  const [hoverArgument, setHoverArgument] = useState<Argument | null>(null);
  const hoverArgumentId = hoverState?.point.argumentId ?? null;

  const clusterIndex = useMemo(() => {
    const ids = Array.from(new Set(map.points.map((point) => point.clusterId)));
    ids.sort();
    return new Map(ids.map((id, index) => [id, index]));
  }, [map.points]);

  const clusterMetaById = useMemo(() => {
    return new Map(map.clusters.map((cluster) => [cluster.id, cluster]));
  }, [map.clusters]);

  const clusterBounds = useMemo(() => {
    const boundsByCluster = new Map<
      string,
      { minX: number; maxX: number; minY: number; maxY: number }
    >();

    for (const point of map.points) {
      const existing = boundsByCluster.get(point.clusterId);
      if (!existing) {
        boundsByCluster.set(point.clusterId, {
          minX: point.x,
          maxX: point.x,
          minY: point.y,
          maxY: point.y,
        });
        continue;
      }
      existing.minX = Math.min(existing.minX, point.x);
      existing.maxX = Math.max(existing.maxX, point.x);
      existing.minY = Math.min(existing.minY, point.y);
      existing.maxY = Math.max(existing.maxY, point.y);
    }

    return boundsByCluster;
  }, [map.points]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = COLORS.concrete;
    ctx.fillRect(0, 0, width, height);

    // cluster regions (neutral background palette; stance colors reserved for borders)
    const baseScale = Math.min(width, height) / 2;
    const s = baseScale * viewport.zoom;
    const centerX = width / 2 + viewport.offsetX;
    const centerY = height / 2 + viewport.offsetY;

    const paddingWorld = 0.06;

    for (const [clusterId, bounds] of clusterBounds) {
      const index = clusterIndex.get(clusterId) ?? 0;
      const fill = clusterFill(index);

      const left = (bounds.minX - paddingWorld) * s + centerX;
      const right = (bounds.maxX + paddingWorld) * s + centerX;
      const top = -(bounds.maxY + paddingWorld) * s + centerY;
      const bottom = -(bounds.minY - paddingWorld) * s + centerY;

      ctx.fillStyle = fill;
      ctx.fillRect(left, top, right - left, bottom - top);

      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, right - left, bottom - top);

      const clusterLabel = clusterMetaById.get(clusterId)?.label;
      if (clusterLabel) {
        ctx.fillStyle = COLORS.ink;
        ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.fillText(clusterLabel, left + 8, top + 16);
      }
    }

    // points
    for (const point of map.points) {
      const x = point.x * s + centerX;
      const y = -point.y * s + centerY;
      const radius = radiusFromWeight(point.weight);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.paper;
      ctx.fill();

      ctx.strokeStyle = stanceStroke(point.stance);
      ctx.lineWidth = hoverState?.point.argumentId === point.argumentId ? 4 : 3;
      ctx.stroke();
    }
  }, [clusterBounds, clusterIndex, clusterMetaById, hoverState?.point.argumentId, map.points, viewport]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (!hoverArgumentId) {
      setHoverArgument(null);
      return;
    }

    const cached = argumentCacheRef.current.get(hoverArgumentId);
    if (cached) {
      setHoverArgument(cached);
      return;
    }

    let cancelled = false;
    setHoverArgument(null);

    (async () => {
      const result = await apiClient.getArgument(hoverArgumentId, map.topicId);
      if (cancelled) return;
      if (!result.ok) return;

      argumentCacheRef.current.set(hoverArgumentId, result.data.argument);
      setHoverArgument(result.data.argument);
    })();

    return () => {
      cancelled = true;
    };
  }, [hoverArgumentId, map.topicId]);

  const updateHover = useCallback(
    (pointer: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = canvas.width;
      const height = canvas.height;

      const baseScale = Math.min(width, height) / 2;
      const s = baseScale * viewport.zoom;
      const centerX = width / 2 + viewport.offsetX;
      const centerY = height / 2 + viewport.offsetY;

      let best: { point: ClusterMapPoint; dist2: number } | null = null;

      for (const point of map.points) {
        const x = point.x * s + centerX;
        const y = -point.y * s + centerY;
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const dist2 = dx * dx + dy * dy;
        const hitRadius = radiusFromWeight(point.weight) + 6;
        if (dist2 > hitRadius * hitRadius) continue;
        if (!best || dist2 < best.dist2) best = { point, dist2 };
      }

      if (!best) {
        setHoverState(null);
        return;
      }

      setHoverState({ point: best.point, pointerX: pointer.x, pointerY: pointer.y });
    },
    [map.points, viewport],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const pointer = getCanvasPointer(canvas, event.clientX, event.clientY);

      if (dragState && dragState.pointerId === event.pointerId) {
        setViewport((prev) => ({
          ...prev,
          offsetX: dragState.startOffsetX + (pointer.x - dragState.startX),
          offsetY: dragState.startOffsetY + (pointer.y - dragState.startY),
        }));
        setHoverState(null);
        return;
      }

      updateHover(pointer);
    },
    [dragState, updateHover],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(event.pointerId);
      const pointer = getCanvasPointer(canvas, event.clientX, event.clientY);

      setDragState({
        pointerId: event.pointerId,
        startX: pointer.x,
        startY: pointer.y,
        startOffsetX: viewport.offsetX,
        startOffsetY: viewport.offsetY,
      });
      setHoverState(null);
    },
    [viewport.offsetX, viewport.offsetY],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  }, [dragState]);

  const handlePointerLeave = useCallback(() => {
    setHoverState(null);
    setDragState(null);
  }, []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      event.preventDefault();

      const pointer = getCanvasPointer(canvas, event.clientX, event.clientY);
      const width = canvas.width;
      const height = canvas.height;
      const baseScale = Math.min(width, height) / 2;

      setViewport((prev) => {
        const zoomFactor = Math.exp(-event.deltaY * 0.001);
        const nextZoom = clamp(prev.zoom * zoomFactor, 0.25, 12);

        const sPrev = baseScale * prev.zoom;
        const worldX = (pointer.x - width / 2 - prev.offsetX) / sPrev;
        const worldY = -((pointer.y - height / 2 - prev.offsetY) / sPrev);

        const sNext = baseScale * nextZoom;
        const nextOffsetX = pointer.x - width / 2 - worldX * sNext;
        const nextOffsetY = pointer.y - height / 2 + worldY * sNext;

        return { zoom: nextZoom, offsetX: nextOffsetX, offsetY: nextOffsetY };
      });

      setHoverState(null);
    },
    [],
  );

  return (
    <P5Panel
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            God View
          </h2>
          <div className="text-xs text-white/80">
            <span className="font-mono">Wheel</span> to zoom ·{" "}
            <span className="font-mono">Drag</span> to pan ·{" "}
            <span className="font-mono">Hover</span> for details
          </div>
        </div>
      }
    >
      <div className="relative overflow-hidden border-[3px] border-[color:var(--ink)] bg-[color:var(--concrete-200)] shadow-[2px_2px_0_var(--ink)]">
        <canvas
          ref={canvasRef}
          data-testid="godview-canvas"
          width={800}
          height={600}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
          className="block h-[520px] w-full touch-none select-none"
        />

        {hoverState ? (
          <GodViewCallingCard
            point={hoverState.point}
            argument={hoverArgument}
            clusterLabel={clusterMetaById.get(hoverState.point.clusterId)?.label ?? null}
            clusterSummary={clusterMetaById.get(hoverState.point.clusterId)?.summary ?? null}
            x={hoverState.pointerX}
            y={hoverState.pointerY}
          />
        ) : null}
      </div>
    </P5Panel>
  );
}

function GodViewCallingCard(props: {
  point: ClusterMapPoint;
  argument: Argument | null;
  clusterLabel: string | null;
  clusterSummary: string | null;
  x: number;
  y: number;
}) {
  const votes = weightToVotes(props.point.weight);
  const stanceLabel = stanceLabelFromBucket(props.point.stance);

  const baseX = Number.isFinite(props.x) ? props.x : 0;
  const baseY = Number.isFinite(props.y) ? props.y : 0;

  const style = {
    left: clamp(baseX + 14, 12, 800 - 260),
    top: clamp(baseY + 14, 12, 600 - 160),
  };

  return (
    <div
      data-testid="godview-calling-card"
      className={[
        "pointer-events-none absolute z-10 w-[240px]",
        "border-[4px] border-[color:var(--ink)] bg-white",
        "shadow-[4px_4px_0_#ff0033,8px_8px_0_#1a1a1d]",
        "skew-x-[-3deg] rotate-[-0.6deg]",
      ].join(" ")}
      style={{
        ...style,
        ["--ink" as unknown as keyof CSSProperties]: COLORS.ink,
      }}
    >
      <div className="border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-2 text-white">
        <div
          data-testid="godview-calling-card-title"
          className="font-mono text-xs uppercase tracking-wide"
        >
          {props.point.argumentId}
        </div>
      </div>

      <div className="space-y-2 px-3 py-2 text-xs text-zinc-800">
        {props.clusterLabel ? (
          <p className="font-medium text-zinc-900">{props.clusterLabel}</p>
        ) : null}
        {props.clusterSummary ? <p className="text-zinc-700">{props.clusterSummary}</p> : null}

        <div data-testid="godview-calling-card-body" className="max-h-[180px] overflow-auto pr-1">
          {props.argument?.bodyRich ? (
            <TiptapDocView doc={props.argument.bodyRich} />
          ) : props.argument ? (
            <p className="whitespace-pre-wrap text-zinc-800">{props.argument.body}</p>
          ) : (
            <p className="text-zinc-500">Loading…</p>
          )}
        </div>

        <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 font-mono">
          <dt className="text-zinc-500">votes</dt>
          <dd data-testid="godview-calling-card-meta-votes" className="text-zinc-900">
            {votes}
          </dd>
          <dt className="text-zinc-500">stance</dt>
          <dd data-testid="godview-calling-card-meta-stance" className="text-zinc-900">
            {stanceLabel}
          </dd>
          <dt className="text-zinc-500">cluster</dt>
          <dd data-testid="godview-calling-card-meta-cluster" className="text-zinc-900">
            {props.point.clusterId}
          </dd>
        </dl>
      </div>
    </div>
  );
}

function TiptapDocView(props: { doc: NonNullable<Argument["bodyRich"]> }) {
  return <div className="space-y-1">{renderTiptapNodes(props.doc, "doc")}</div>;
}

function renderTiptapNodes(value: unknown, keyPrefix: string): React.ReactNode {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;

  const type = typeof node.type === "string" ? node.type : "";
  const content = Array.isArray(node.content) ? node.content : [];

  switch (type) {
    case "doc":
      return content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`));
    case "paragraph":
      return (
        <p key={keyPrefix} className="whitespace-pre-wrap text-zinc-800">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </p>
      );
    case "text": {
      const text = typeof node.text === "string" ? node.text : "";
      return applyTiptapMarks(node, text, keyPrefix);
    }
    case "hardBreak":
      return <br key={keyPrefix} />;
    case "heading": {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      const levelRaw = attrs && typeof attrs.level === "number" ? attrs.level : 2;
      const level = clamp(levelRaw, 1, 3);
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      return (
        <Tag key={keyPrefix} className="font-semibold text-zinc-900">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote key={keyPrefix} className="border-l-4 border-zinc-200 pl-3 text-zinc-700">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </blockquote>
      );
    case "bulletList":
      return (
        <ul key={keyPrefix} className="list-disc space-y-1 pl-5 text-zinc-800">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={keyPrefix} className="list-decimal space-y-1 pl-5 text-zinc-800">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </ol>
      );
    case "listItem":
      return (
        <li key={keyPrefix} className="whitespace-pre-wrap">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </li>
      );
    default:
      return content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`));
  }
}

function applyTiptapMarks(
  node: Record<string, unknown>,
  text: string,
  keyPrefix: string,
): React.ReactNode {
  const marks = Array.isArray(node.marks) ? node.marks : [];
  let acc: React.ReactNode = text;

  for (let idx = marks.length - 1; idx >= 0; idx -= 1) {
    const mark = marks[idx];
    if (!mark || typeof mark !== "object") continue;
    const markObj = mark as Record<string, unknown>;
    const type = typeof markObj.type === "string" ? markObj.type : "";

    if (type === "bold") {
      acc = <strong key={`${keyPrefix}-b${idx}`}>{acc}</strong>;
      continue;
    }

    if (type === "italic") {
      acc = <em key={`${keyPrefix}-i${idx}`}>{acc}</em>;
      continue;
    }

    if (type === "underline") {
      acc = <u key={`${keyPrefix}-u${idx}`}>{acc}</u>;
      continue;
    }

    if (type === "link") {
      const attrs = markObj.attrs as Record<string, unknown> | undefined;
      const href = attrs ? sanitizeHref(attrs.href) : null;
      if (!href) continue;
      acc = (
        <a
          key={`${keyPrefix}-l${idx}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-zinc-400 underline-offset-2"
        >
          {acc}
        </a>
      );
    }
  }

  return acc;
}

function sanitizeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return href;
    }
    return null;
  } catch {
    return null;
  }
}

function stanceStroke(stance: -1 | 0 | 1): string {
  if (stance === 1) return COLORS.pro;
  if (stance === -1) return COLORS.con;
  return COLORS.neutral;
}

function stanceLabelFromBucket(stance: -1 | 0 | 1): string {
  if (stance === 1) return "PRO";
  if (stance === -1) return "CON";
  return "NEUTRAL";
}

function clusterFill(index: number): string {
  const palette = ["rgba(255,255,255,0.55)", "rgba(229,229,229,0.55)", "rgba(212,212,212,0.55)"];
  return palette[index % palette.length];
}

function radiusFromWeight(weight: number): number {
  return clamp(2 + weight * 2.2, 2, 12);
}

function weightToVotes(weight: number): number {
  const estimate = Math.exp(weight) - 1;
  if (!Number.isFinite(estimate) || estimate < 0) return 0;
  return Math.max(0, Math.round(estimate));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getCanvasPointer(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width ? canvas.width / rect.width : 1;
  const scaleY = rect.height ? canvas.height / rect.height : 1;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}
