"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { ConsensusReport, TopicSummary } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";
import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Alert, Button, useToast } from "@/components/ui/kit";

type Props = {
  topicId: string;
};

type LoadState =
  | { status: "loading"; errorMessage: ""; topic: null; report: null }
  | { status: "error"; errorMessage: string; topic: TopicSummary | null; report: ConsensusReport | null }
  | { status: "success"; errorMessage: ""; topic: TopicSummary; report: ConsensusReport | null };

export function ConsensusReportPage({ topicId }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const rid = searchParams.get("rid");
  const bridgeParam = searchParams.get("bridge");

  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const [identityPubkeyHex, setIdentityPubkeyHex] = useState<string | null>(null);

  useEffect(() => {
    try {
      const masterSeedHex = keyStore.getMasterSeedHex();
      if (!masterSeedHex) {
        setIdentityPubkeyHex(null);
        return;
      }
      const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(masterSeedHex, topicId);
      setIdentityPubkeyHex(pubkeyHex);
    } catch {
      setIdentityPubkeyHex(null);
    }
  }, [keyStore, topicId]);

  const [state, setState] = useState<LoadState>({
    status: "loading",
    errorMessage: "",
    topic: null,
    report: null,
  });

  const load = useCallback(async () => {
    setState({ status: "loading", errorMessage: "", topic: null, report: null });

    const [topicRes, reportRes] = await Promise.all([
      apiClient.getTopicTree(topicId, 1),
      rid ? apiClient.getConsensusReportById(topicId, rid) : apiClient.getLatestConsensusReport(topicId),
    ]);

    if (!topicRes.ok) {
      setState({ status: "error", errorMessage: topicRes.error.message, topic: null, report: null });
      return;
    }

    if (!reportRes.ok) {
      setState({
        status: "error",
        errorMessage: reportRes.error.message,
        topic: topicRes.data.topic,
        report: null,
      });
      return;
    }

    const report = "report" in reportRes.data ? reportRes.data.report : null;
    setState({ status: "success", errorMessage: "", topic: topicRes.data.topic, report });
  }, [rid, topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const topic = state.status === "success" ? state.topic : state.topic;
  const report = state.status === "success" ? state.report : state.report;

  const ownerPubkey = topic?.ownerPubkey ?? null;
  const isOwner = identityPubkeyHex !== null && ownerPubkey !== null && identityPubkeyHex === ownerPubkey;

  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState("");

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

    toast({ variant: "success", title: t("report.consensusReport"), message: t("report.generatingReport") });
    void load();
  }

  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[980px] items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="border border-border bg-background"
                onClick={() => router.back()}
              >
                {t("common.back")}
              </Button>
              <h1 className="min-w-0 truncate font-serif text-sm font-semibold">
                {topic?.title ?? t("report.consensusReport")}
              </h1>
            </div>
            {report && report.status !== "generating" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("report.updatedAt", { time: new Date(report.computedAt).toLocaleString() })}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="border border-border bg-background"
              onClick={() => void load()}
            >
              {t("common.refresh")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[980px] px-4 py-6">
        {state.status === "loading" ? (
          <p className="text-sm text-muted-foreground">{t("report.loadingReport")}</p>
        ) : null}

        {state.status === "error" ? (
          <div className="space-y-3">
            <Alert role="alert" variant="error" title={t("common.error")}>
              {state.errorMessage}
            </Alert>
            <div>
              <Button variant="ghost" size="sm" className="border border-border bg-background" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
        ) : null}

        {state.status === "success" ? (
          <div className="space-y-6">
            {!report ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("report.noReportYet")}</p>
                {isOwner ? (
                  <div className="space-y-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="border border-border"
                      onClick={triggerGeneration}
                      disabled={isTriggering}
                    >
                      {isTriggering ? t("report.generatingAction") : t("report.generateReport")}
                    </Button>
                    {triggerError ? (
                      <Alert role="alert" variant="error" title={t("common.error")}>
                        {triggerError}
                      </Alert>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : report.status === "generating" ? (
              <GeneratingView />
            ) : report.status === "failed" ? (
              <div className="space-y-3">
                <Alert role="alert" variant="error" title={t("report.reportFailedTitle")}>
                  {(report.metadata as any)?.error?.message ?? t("report.unknownError")}
                </Alert>
                {isOwner ? (
                  <div className="space-y-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="border border-border"
                      onClick={triggerGeneration}
                      disabled={isTriggering}
                    >
                      {isTriggering ? t("report.generatingAction") : t("report.generateReport")}
                    </Button>
                    {triggerError ? (
                      <Alert role="alert" variant="error" title={t("common.error")}>
                        {triggerError}
                      </Alert>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <ReportReadyView topicId={topicId} report={report} highlightedBridgeId={bridgeParam} />
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function GeneratingView() {
  const { t } = useI18n();

  const steps = [
    t("report.stepCollectSources"),
    t("report.stepInduceRoles"),
    t("report.stepDraftBridges"),
    t("report.stepCritique"),
    t("report.stepRevise"),
    t("report.stepRender"),
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("report.generatingReport")}</p>
      <ol className="space-y-1 text-sm text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>- {step}</li>
        ))}
      </ol>
    </div>
  );
}

type BridgeStatement = {
  id: string;
  text: string;
  conditions: string[];
  sourceLabels: string[];
};

type BridgesMeta = {
  gallerySize: number;
  galleryIds: string[];
  statements: BridgeStatement[];
};

function getBridgesMeta(report: ConsensusReport): BridgesMeta | null {
  const metadata = report.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const bridges = (metadata as any).bridges;
  if (!bridges || typeof bridges !== "object" || Array.isArray(bridges)) return null;

  const gallerySizeRaw = (bridges as any).gallerySize;
  const galleryIdsRaw = (bridges as any).galleryIds;
  const statementsRaw = (bridges as any).statements;

  const gallerySize = typeof gallerySizeRaw === "number" && Number.isFinite(gallerySizeRaw) ? gallerySizeRaw : 3;
  const galleryIds = Array.isArray(galleryIdsRaw) ? galleryIdsRaw.filter((v) => typeof v === "string") : [];
  const statements = Array.isArray(statementsRaw) ? statementsRaw : [];

  const parsedStatements: BridgeStatement[] = [];
  for (const item of statements) {
    const id = (item as any)?.id;
    const text = (item as any)?.text;
    const conditionsRaw = (item as any)?.conditions;
    const sourceLabelsRaw = (item as any)?.sourceLabels;

    if (typeof id !== "string" || !/^B\d+$/.test(id)) continue;
    if (typeof text !== "string" || !text.trim()) continue;
    const conditions = Array.isArray(conditionsRaw) ? conditionsRaw.filter((c) => typeof c === "string" && c.trim()) : [];
    const sourceLabels = Array.isArray(sourceLabelsRaw)
      ? sourceLabelsRaw.filter((s) => typeof s === "string" && /^S\d+$/.test(s))
      : [];

    parsedStatements.push({
      id,
      text: text.trim(),
      conditions,
      sourceLabels,
    });
  }

  if (!parsedStatements.length) return null;
  const effectiveGalleryIds = galleryIds.filter((id) => parsedStatements.some((s) => s.id === id));
  const fallbackGalleryIds = parsedStatements.slice(0, gallerySize).map((s) => s.id);

  return {
    gallerySize,
    galleryIds: effectiveGalleryIds.length ? effectiveGalleryIds.slice(0, gallerySize) : fallbackGalleryIds,
    statements: parsedStatements,
  };
}

function getSourceMap(report: ConsensusReport): Record<string, { argumentId: string; authorId: string; excerpt?: string }> | null {
  const metadata = report.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const sources = (metadata as any).sources;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return null;

  const map: Record<string, { argumentId: string; authorId: string; excerpt?: string }> = {};
  for (const [label, value] of Object.entries(sources as Record<string, unknown>)) {
    if (!/^S\d+$/.test(label)) continue;
    const argumentId = (value as any)?.argumentId;
    const authorId = (value as any)?.authorId;
    const excerpt = (value as any)?.excerpt;
    if (typeof argumentId !== "string" || typeof authorId !== "string") continue;
    map[label] = { argumentId, authorId, excerpt: typeof excerpt === "string" ? excerpt : undefined };
  }

  return Object.keys(map).length ? map : null;
}

function ReportReadyView(props: {
  topicId: string;
  report: Extract<ConsensusReport, { status: "ready" }>;
  highlightedBridgeId: string | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();

  const bridges = useMemo(() => getBridgesMeta(props.report), [props.report]);
  const sourceMap = useMemo(() => getSourceMap(props.report), [props.report]);

  const [showAllBridges, setShowAllBridges] = useState(false);

  const statements = bridges?.statements ?? [];
  const galleryStatements = bridges
    ? bridges.galleryIds.map((id) => statements.find((s) => s.id === id)).filter((s): s is BridgeStatement => Boolean(s))
    : [];

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const reportPermalink = useCallback(() => {
    if (!origin) return "";
    const url = new URL(`/topics/${props.topicId}/report`, origin);
    url.searchParams.set("rid", props.report.id);
    return url.toString();
  }, [origin, props.report.id, props.topicId]);

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ variant: "success", title: t("report.consensusReport"), message: successMessage });
    } catch {
      toast({ variant: "error", title: t("common.error"), message: t("common.copyFailed") });
    }
  };

  const bridgeLink = (bridgeId: string) => {
    if (!origin) return "";
    const url = new URL(`/topics/${props.topicId}/report`, origin);
    url.searchParams.set("rid", props.report.id);
    url.searchParams.set("bridge", bridgeId);
    url.hash = `bridge-${bridgeId}`;
    return url.toString();
  };

  useEffect(() => {
    if (!props.highlightedBridgeId) return;
    if (!/^B\d+$/.test(props.highlightedBridgeId)) return;
    if (galleryStatements.some((b) => b.id === props.highlightedBridgeId)) return;
    if (statements.some((b) => b.id === props.highlightedBridgeId)) {
      setShowAllBridges(true);
    }
  }, [galleryStatements, props.highlightedBridgeId, statements]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">{t("report.bridgeGallery")}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="border border-border bg-background"
              onClick={() => void copyText(reportPermalink(), t("common.copied"))}
            >
              {t("report.copyReportLink")}
            </Button>
          </div>
        </div>

        {galleryStatements.length ? (
          <div className="grid gap-3 md:grid-cols-3">
            {galleryStatements.map((bridge) => (
              <BridgeCard
                key={bridge.id}
                bridge={bridge}
                topicId={props.topicId}
                reportId={props.report.id}
                bridgeHref={bridgeLink(bridge.id)}
                highlighted={props.highlightedBridgeId === bridge.id}
                onCopyLink={() => void copyText(bridgeLink(bridge.id), t("common.copied"))}
                onCopyText={() => {
                  const lines = [
                    `Bridge ${bridge.id}`,
                    bridge.text,
                    bridge.conditions.length ? "" : null,
                    bridge.conditions.length ? `Conditions: ${bridge.conditions.join(" / ")}` : null,
                    bridge.sourceLabels.length ? `Sources: ${bridge.sourceLabels.map((s) => `[${s}]`).join(" ")}` : null,
                    "",
                    bridgeLink(bridge.id),
                  ].filter((v): v is string => typeof v === "string" && v !== "");
                  void copyText(lines.join("\n"), t("common.copied"));
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("report.bridgeGalleryUnavailable")}</p>
        )}

        {statements.length > galleryStatements.length ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="border border-border bg-background"
              onClick={() => setShowAllBridges((v) => !v)}
            >
              {showAllBridges ? t("report.hideAllBridges") : t("report.viewAllBridges", { count: statements.length })}
            </Button>
          </div>
        ) : null}

        {showAllBridges && statements.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {statements.map((bridge) => (
              <BridgeCard
                key={`all-${bridge.id}`}
                bridge={bridge}
                topicId={props.topicId}
                reportId={props.report.id}
                bridgeHref={bridgeLink(bridge.id)}
                highlighted={props.highlightedBridgeId === bridge.id}
                onCopyLink={() => void copyText(bridgeLink(bridge.id), t("common.copied"))}
                onCopyText={() => {
                  const lines = [
                    `Bridge ${bridge.id}`,
                    bridge.text,
                    bridge.conditions.length ? "" : null,
                    bridge.conditions.length ? `Conditions: ${bridge.conditions.join(" / ")}` : null,
                    bridge.sourceLabels.length ? `Sources: ${bridge.sourceLabels.map((s) => `[${s}]`).join(" ")}` : null,
                    "",
                    bridgeLink(bridge.id),
                  ].filter((v): v is string => typeof v === "string" && v !== "");
                  void copyText(lines.join("\n"), t("common.copied"));
                }}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold">{t("report.reportBody")}</h2>
        <ReportMarkdown content={props.report.contentMd} topicId={props.topicId} sourceMap={sourceMap} />
      </section>
    </div>
  );
}

function BridgeCard(props: {
  bridge: BridgeStatement;
  topicId: string;
  reportId: string;
  bridgeHref: string;
  highlighted: boolean;
  onCopyLink: () => void;
  onCopyText: () => void;
}) {
  const { t } = useI18n();

  return (
    <article
      id={`bridge-${props.bridge.id}`}
      className={[
        "rounded-xl border bg-background p-4 shadow-sm",
        props.highlighted ? "border-primary/70 ring-2 ring-primary/20" : "border-border/70",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            {t("report.bridgeStatement")} · {props.bridge.id}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" className="border border-border bg-background" onClick={props.onCopyLink}>
            {t("report.copyLink")}
          </Button>
          <Button variant="ghost" size="sm" className="border border-border bg-background" onClick={props.onCopyText}>
            {t("report.copyText")}
          </Button>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap font-serif text-sm leading-relaxed text-foreground">
        {props.bridge.text}
      </p>

      {props.bridge.conditions.length ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            {t("report.conditions")}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
            {props.bridge.conditions.map((c, idx) => (
              <li key={`${props.bridge.id}-cond-${idx}`}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {props.bridge.sourceLabels.slice(0, 6).map((label) => (
            <span key={label} className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
              [{label}]
            </span>
          ))}
          {props.bridge.sourceLabels.length > 6 ? (
            <span className="text-xs text-muted-foreground">+{props.bridge.sourceLabels.length - 6}</span>
          ) : null}
        </div>
        {props.bridgeHref ? (
          <a
            className="text-xs text-foreground underline decoration-dotted underline-offset-2"
            href={props.bridgeHref}
          >
            {t("report.openContext")}
          </a>
        ) : null}
      </div>
    </article>
  );
}

type ReportSourceMap = Record<string, { argumentId: string; authorId: string; excerpt?: string }>;

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

function ReportMarkdown(props: {
  content: string;
  topicId: string;
  sourceMap: ReportSourceMap | null;
}) {
  const { t } = useI18n();

  const blocks = useMemo(() => parseMarkdown(props.content), [props.content]);
  const citationLabels = useMemo(() => extractCitationLabels(props.content), [props.content]);
  const labelToIndex = useMemo(() => {
    const map = new Map<string, number>();
    citationLabels.forEach((label, idx) => map.set(label, idx + 1));
    return map;
  }, [citationLabels]);

  const renderInline = useCallback((text: string) => {
    const parts: ReactNode[] = [];
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
              aria-label={t("report.footnoteAria", { index })}
              className="font-mono text-foreground underline decoration-dotted underline-offset-2"
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
  }, [labelToIndex, t]);

  return (
    <article className="prose prose-zinc max-w-none">
      {blocks.map((block) => {
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
          return (
            <Tag key={block.key} id={block.key} className="scroll-mt-24 text-zinc-900">
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
          <h3 className="text-zinc-900">{t("report.footnotes")}</h3>
          <ol className="space-y-3 pl-5">
            {citationLabels.map((label) => {
              const index = labelToIndex.get(label);
              if (!index) return null;

              const source = props.sourceMap?.[label] ?? null;
              const href = source ? `/topics/${props.topicId}?arg=${encodeURIComponent(source.argumentId)}` : null;

              return (
                <li key={label} id={`footnote-${label}`} className="space-y-1 break-all">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-600">{label}</span>
                    {href ? (
                      <a
                        className="rounded-sm border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 hover:bg-zinc-50"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("common.open")}
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-600">{t("report.sourceMissing")}</span>
                    )}
                  </div>
                  {source?.excerpt ? (
                    <p className="text-xs text-zinc-700">{source.excerpt}</p>
                  ) : null}
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
