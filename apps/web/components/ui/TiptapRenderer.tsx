"use client";

import type { ReactNode } from "react";

type TiptapMark = { type?: unknown };
type TiptapNode = {
  type?: unknown;
  text?: unknown;
  marks?: unknown;
  content?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNodes(value: unknown): TiptapNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TiptapNode => isRecord(item));
}

function hasBold(marks: unknown): boolean {
  if (!Array.isArray(marks)) return false;
  return marks.some((mark) => isRecord(mark) && mark.type === "bold");
}

function renderInline(node: TiptapNode, key: string): ReactNode {
  if (node.type === "text" && typeof node.text === "string") {
    const text = node.text;
    if (hasBold(node.marks)) return <strong key={key}>{text}</strong>;
    return <span key={key}>{text}</span>;
  }

  if (node.type === "hardBreak") {
    return <br key={key} />;
  }

  return null;
}

function renderBlock(node: TiptapNode, key: string): ReactNode {
  if (node.type === "paragraph") {
    const children = asNodes(node.content).map((child, index) =>
      renderInline(child, `${key}-i${index}`),
    );
    return (
      <p key={key} className="whitespace-pre-wrap">
        {children}
      </p>
    );
  }

  return null;
}

export function TiptapRenderer(props: { doc: unknown | null | undefined; fallback?: string }) {
  const doc = props.doc;

  if (!doc || !isRecord(doc) || doc.type !== "doc") {
    return props.fallback ? (
      <p className="whitespace-pre-wrap">{props.fallback}</p>
    ) : null;
  }

  const blocks = asNodes(doc.content).map((node, index) => renderBlock(node, `b${index}`));
  return <div className="space-y-2">{blocks}</div>;
}

