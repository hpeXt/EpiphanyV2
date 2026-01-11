"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ConsensusReport } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";

type Props = {
  topicId: string;
  isOwner: boolean;
  refreshToken: number;
  onInvalidate: () => void;
  onClose: () => void;
};

type LoadState =
  | { status: "loading"; errorMessage: ""; report: null }
  | { status: "error"; errorMessage: string; report: null }
  | { status: "success"; errorMessage: ""; report: ConsensusReport | null };

export function ConsensusReportModal({
  topicId,
  isOwner,
  refreshToken,
  onInvalidate,
  onClose,
}: Props) {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    errorMessage: "",
    report: null,
  });

  const sourceMap = useMemo(() => {
    const report = state.status === "success" ? state.report : null;
    return report ? getConsensusReportSourceMap(report) : null;
  }, [state]);

  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState("");

  const loadLatest = useCallback(async () => {
    setState({ status: "loading", errorMessage: "", report: null });
    const result = await apiClient.getLatestConsensusReport(topicId);
    if (!result.ok) {
      setState({ status: "error", errorMessage: result.error.message, report: null });
      return;
    }
    setState({ status: "success", errorMessage: "", report: result.data.report });
  }, [topicId]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest, refreshToken]);

  const report = state.status === "success" ? state.report : null;

  const title = useMemo(() => {
    if (!report) return "Consensus report";
    if (report.status === "ready") return "Consensus report";
    if (report.status === "generating") return "Consensus report (generating)";
    return "Consensus report (failed)";
  }, [report]);

  async function triggerGeneration() {
    if (!isOwner) return;
    setTriggerError("");
    setIsTriggering(true);
    const result = await apiClient.executeTopicCommand(topicId, {
      type: "GENERATE_CONSENSUS_REPORT",
      payload: {},
    });
    setIsTriggering(false);

    if (!result.ok) {
      setTriggerError(result.error.message);
      return;
    }

    onInvalidate();
    await loadLatest();
  }

  return (
    <div
      role="dialog"
      aria-label="Consensus report"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-rebel)]"
        style={{
          clipPath:
            "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
        }}
      >
        <div className="flex items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">{title}</h2>
          <P5Button
            type="button"
            onClick={onClose}
            size="sm"
            className="border-[color:var(--paper)] text-[color:var(--paper)] shadow-none hover:bg-white/10"
          >
            Close
          </P5Button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-5 py-4">
          {state.status === "loading" ? (
            <p className="text-sm text-[color:var(--ink)]/80">Loading report…</p>
          ) : null}

          {state.status === "error" ? (
            <P5Alert role="alert" variant="error" title="error">
              {state.errorMessage}
            </P5Alert>
          ) : null}

          {state.status === "success" ? (
            <div className="space-y-4">
              {!report ? (
                <p className="text-sm text-[color:var(--ink)]/90">No report yet.</p>
              ) : report.status === "generating" ? (
                <p className="text-sm text-[color:var(--ink)]/90">Generating report…</p>
              ) : report.status === "failed" ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[color:var(--rebel-red)]">
                    Report failed
                  </p>
                  <p className="text-sm text-[color:var(--rebel-red)]">
                    {(report.metadata as any)?.error?.message ?? "Unknown error"}
                  </p>
                </div>
              ) : (
                <Markdown
                  content={report.contentMd}
                  topicId={topicId}
                  sourceMap={sourceMap}
                  onRequestClose={onClose}
                />
              )}

              {triggerError ? (
                <P5Alert role="alert" variant="error" title="error">
                  {triggerError}
                </P5Alert>
              ) : null}

              {isOwner ? (
                <div className="flex flex-wrap gap-2">
                  <P5Button
                    type="button"
                    onClick={triggerGeneration}
                    disabled={isTriggering || report?.status === "generating"}
                    variant="primary"
                  >
                    {isTriggering ? "Generating…" : "Generate report"}
                  </P5Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ReportSourceMap = Record<string, { argumentId: string; authorId: string }>;

function getConsensusReportSourceMap(report: ConsensusReport): ReportSourceMap | null {
  const metadata = report.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const sources = (metadata as any).sources;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return null;

  const map: ReportSourceMap = {};
  for (const [label, value] of Object.entries(sources as Record<string, unknown>)) {
    if (!/^S\d+$/.test(label)) continue;
    const argumentId = (value as any)?.argumentId;
    const authorId = (value as any)?.authorId;
    if (typeof argumentId !== "string" || typeof authorId !== "string") continue;
    map[label] = { argumentId, authorId };
  }

  return Object.keys(map).length ? map : null;
}

function extractCitationLabels(content: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const regex = /\[(S\d+)\]/g;

  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(content)) !== null) {
    const label = match[1];
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }

  return labels;
}

function Markdown(props: {
  content: string;
  topicId: string;
  sourceMap: ReportSourceMap | null;
  onRequestClose: () => void;
}) {
  const router = useRouter();

  const blocks = useMemo(() => parseMarkdown(props.content), [props.content]);

  const citationLabels = useMemo(() => extractCitationLabels(props.content), [props.content]);
  const labelToIndex = useMemo(() => {
    const map = new Map<string, number>();
    citationLabels.forEach((label, idx) => map.set(label, idx + 1));
    return map;
  }, [citationLabels]);

  const renderInline = useCallback((text: string) => {
    const parts: Array<string | JSX.Element> = [];
    const regex = /\[(S\d+)\]/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start));
      }

      const label = match[1];
      const index = labelToIndex.get(label);
      if (!index) {
        parts.push(match[0]);
      } else {
        parts.push(
          <sup key={`${label}-${start}`} className="ml-0.5 align-super text-[0.75em]">
            <a
              href={`#footnote-${label}`}
              aria-label={`Footnote ${index}`}
              className="font-mono text-[color:var(--ink)] underline decoration-dotted underline-offset-2"
            >
              {index}
            </a>
          </sup>,
        );
      }

      lastIndex = end;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }, [labelToIndex]);

  return (
    <article className="prose prose-zinc max-w-none">
      {blocks.map((block) => {
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
          return (
            <Tag key={block.key} className="text-zinc-900">
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={block.key} className="list-disc pl-5">
              {block.items.map((item, index) => (
                <li key={`${block.key}-${index}`}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "code") {
          return (
            <pre key={block.key} className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-zinc-50">
              <code>{block.text}</code>
            </pre>
          );
        }
        return (
          <p key={block.key} className="whitespace-pre-wrap text-zinc-800">
            {renderInline(block.text)}
          </p>
        );
      })}

      {citationLabels.length ? (
        <section className="mt-8">
          <hr className="my-6 border-zinc-200" />
          <h3 className="text-zinc-900">Footnotes</h3>
          <ol className="space-y-2 pl-5">
            {citationLabels.map((label) => {
              const index = labelToIndex.get(label);
              if (!index) return null;

              const source = props.sourceMap?.[label] ?? null;
              const href = source ? `/topics/${props.topicId}?arg=${encodeURIComponent(source.argumentId)}` : null;

              return (
                <li key={label} id={`footnote-${label}`} className="break-all">
                  <div className="flex flex-wrap items-center gap-2">
                    {href ? (
                      <button
                        type="button"
                        className="rounded-sm border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 hover:bg-zinc-50"
                        onClick={() => {
                          props.onRequestClose();
                          router.push(href);
                        }}
                      >
                        Open
                      </button>
                    ) : (
                      <span className="font-mono text-xs text-zinc-600">{label}</span>
                    )}

                    {source ? (
                      <span className="font-mono text-xs text-zinc-700">
                        topic:{props.topicId} · author:{source.authorId} · argument:{source.argumentId}
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-zinc-600">
                        (source mapping missing for {label})
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string; key: string }
  | { type: "ul"; items: string[]; key: string }
  | { type: "code"; text: string; key: string }
  | { type: "p"; text: string; key: string };

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let inCode = false;
  let codeLines: string[] = [];
  let listItems: string[] | null = null;
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const text = paragraphLines.join("\n").trimEnd();
    paragraphLines = [];
    if (!text.trim()) return;
    blocks.push({ type: "p", text, key: `p-${blocks.length}` });
  }

  function flushList() {
    if (!listItems || listItems.length === 0) {
      listItems = null;
      return;
    }
    blocks.push({ type: "ul", items: listItems, key: `ul-${blocks.length}` });
    listItems = null;
  }

  function flushCode() {
    const text = codeLines.join("\n");
    codeLines = [];
    blocks.push({ type: "code", text, key: `code-${blocks.length}` });
  }

  for (const rawLine of lines) {
    const line = rawLine;

    if (line.startsWith("```")) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trimEnd();
    if (!trimmed.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: 1,
        text: trimmed.slice(2).trim(),
        key: `h1-${blocks.length}`,
      });
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: 2,
        text: trimmed.slice(3).trim(),
        key: `h2-${blocks.length}`,
      });
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: 3,
        text: trimmed.slice(4).trim(),
        key: `h3-${blocks.length}`,
      });
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      listItems ??= [];
      listItems.push(trimmed.slice(2).trim());
      continue;
    }

    paragraphLines.push(trimmed);
  }

  if (inCode) {
    inCode = false;
    flushCode();
  }

  flushParagraph();
  flushList();

  return blocks;
}
