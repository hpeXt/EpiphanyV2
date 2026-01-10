"use client";

import type { ReactNode } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function TiptapRenderer(props: { doc: unknown | null | undefined; fallback?: string }) {
  const doc = props.doc;

  if (!doc || !isRecord(doc) || doc.type !== "doc") {
    return props.fallback ? (
      <p className="whitespace-pre-wrap">{props.fallback}</p>
    ) : null;
  }

  return <div className="space-y-2">{renderTiptapNodes(doc, "doc")}</div>;
}

function renderTiptapNodes(value: unknown, keyPrefix: string): ReactNode {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;

  const type = typeof node.type === "string" ? node.type : "";
  const content = Array.isArray(node.content) ? node.content : [];

  switch (type) {
    case "doc":
      return content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`));
    case "paragraph":
      return (
        <p key={keyPrefix} className="whitespace-pre-wrap">
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
      const attrs = isRecord(node.attrs) ? node.attrs : null;
      const levelRaw = attrs && typeof attrs.level === "number" ? attrs.level : 2;
      const level = clamp(levelRaw, 1, 4);
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : level === 3 ? "h4" : "h5";
      return (
        <Tag key={keyPrefix} className="font-serif">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote key={keyPrefix}>
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </blockquote>
      );
    case "bulletList":
      return (
        <ul key={keyPrefix}>
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={keyPrefix}>
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </ol>
      );
    case "listItem":
      return (
        <li key={keyPrefix} className="whitespace-pre-wrap">
          {content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}
        </li>
      );
    case "codeBlock":
      return (
        <pre key={keyPrefix}>
          <code>{content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`))}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={keyPrefix} />;
    default:
      return content.map((child, idx) => renderTiptapNodes(child, `${keyPrefix}-${idx}`));
  }
}

function applyTiptapMarks(
  node: Record<string, unknown>,
  text: string,
  keyPrefix: string,
): ReactNode {
  const marks = Array.isArray(node.marks) ? node.marks : [];
  let acc: ReactNode = text;

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

    if (type === "code") {
      acc = <code key={`${keyPrefix}-c${idx}`}>{acc}</code>;
      continue;
    }

    if (type === "link") {
      const attrs = isRecord(markObj.attrs) ? markObj.attrs : null;
      const href = attrs ? sanitizeHref(attrs.href) : null;
      if (!href) continue;
      acc = (
        <a
          key={`${keyPrefix}-l${idx}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-border underline-offset-2 hover:text-foreground"
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
