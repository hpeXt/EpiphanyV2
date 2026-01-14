"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { zTiptapDoc, type Argument, type LedgerMe, type TiptapDoc } from "@epiphany/shared-contracts";
import TipTapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { TopicManagePanel } from "@/components/topics/TopicManagePanel";
import { useTopicSse } from "@/components/topics/hooks/useTopicSse";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";
import { Alert, Badge, Button, Input, useToast } from "@/components/ui/kit";
import { TiptapRenderer } from "@/components/ui/TiptapRenderer";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Sunburst } from "@/components/visualizations/Sunburst";
import { createLocalStorageClaimTokenStore } from "@/lib/claimTokenStore";
import { createLocalStorageDraftStore } from "@/lib/draftStore";
import { authorIdFromPubkeyHex, deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
import { pseudonymFromAuthorId } from "@/lib/pseudonym";
import { apiClient, type ApiError } from "@/lib/apiClient";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { createLocalStorageTopicAccessKeyStore } from "@/lib/topicAccessKeyStore";
import { buildSunburstTreeFromFlatNodes } from "@/lib/visualization/sunburst/adapters";
import { createLocalStorageVisitedTopicsStore } from "@/lib/visitedTopicsStore";

type Props = {
  topicId: string;
};

type HoverCardState = {
  argument: Argument;
  x: number;
  y: number;
};

const LEFT_PANE_WIDTH_STORAGE_KEY = "topicStage:leftPaneWidth:v1";
const DEFAULT_LEFT_PANE_WIDTH = 380;
const MIN_LEFT_PANE_WIDTH = 280;
const MAX_LEFT_PANE_WIDTH = 560;
const LEFT_PANE_HOVER_EXPANDED_WIDTH = 480;
const PANE_RESIZER_WIDTH = 12; // Tailwind w-3
const MIN_CENTER_PANE_WIDTH = 360;

const RELATED_PANE_WIDTH_STORAGE_KEY = "topicStage:relatedPaneWidth:v1";
const DEFAULT_RELATED_PANE_WIDTH = 320;
const MIN_RELATED_PANE_WIDTH = 260;
const MAX_RELATED_PANE_WIDTH = 480;

function stripLeadMarkdownPrefix(input: string): string {
  let out = input.trimStart();
  let prev: string | null = null;

  while (prev !== out) {
    prev = out;
    out = out.replace(/^>\s+/, "");
    out = out.replace(/^[-*•]\s+/, "");
    out = out.replace(/^\d+[.)]\s+/, "");
    out = out.replace(/^#+\s+/, "");
    out = out.trimStart();
  }

  return out;
}

function isLikelyCjk(text: string): boolean {
  return /[\u4E00-\u9FFF]/.test(text);
}

function trimTrailingDanglingPunctuation(text: string): string {
  let out = text.trimEnd();
  out = out.replace(/[([【“「『]+$/g, "");
  out = out.replace(/[:：—–\-、，,]+$/g, "");
  return out.trimEnd();
}

function truncateNicely(
  text: string,
  {
    minLen = 12,
    targetLen = 48,
    hardMax = 80,
  }: { minLen?: number; targetLen?: number; hardMax?: number } = {},
): string {
  const input = text.trim();
  if (!input) return "";
  if (input.length <= hardMax) return input;

  const upper = Math.min(hardMax, input.length);
  const lower = Math.min(Math.max(minLen, 1), upper);

  const punctuation = /[。！？!?…\.]/g;
  const punctPositions: number[] = [];
  for (const match of input.slice(0, upper).matchAll(punctuation)) {
    if (match.index === undefined) continue;
    const idx = match.index;
    if (idx + 1 < lower) continue;
    punctPositions.push(idx + 1);
  }

  if (punctPositions.length > 0) {
    let best = punctPositions[0]!;
    let bestDist = Math.abs(best - targetLen);
    for (const pos of punctPositions) {
      const dist = Math.abs(pos - targetLen);
      if (dist < bestDist) {
        best = pos;
        bestDist = dist;
      }
    }
    const cut = trimTrailingDanglingPunctuation(input.slice(0, best));
    return cut ? `${cut}…` : `${input.slice(0, upper).trimEnd()}…`;
  }

  const within = input.slice(0, upper);
  if (!isLikelyCjk(within)) {
    const spaceAfterTarget = within.slice(targetLen).search(/[\s,.;:：，]/);
    if (spaceAfterTarget >= 0) {
      const cutIdx = Math.min(upper, targetLen + spaceAfterTarget);
      const cut = trimTrailingDanglingPunctuation(within.slice(0, cutIdx));
      return cut ? `${cut}…` : `${within.slice(0, cutIdx).trimEnd()}…`;
    }

    const lastSpaceBefore = within.lastIndexOf(" ");
    if (lastSpaceBefore >= lower) {
      const cut = trimTrailingDanglingPunctuation(within.slice(0, lastSpaceBefore));
      return cut ? `${cut}…` : `${within.slice(0, lastSpaceBefore).trimEnd()}…`;
    }
  }

  const cut = trimTrailingDanglingPunctuation(within);
  return cut ? `${cut}…` : `${within.trimEnd()}…`;
}

function extractLeadSentence(body: string): string {
  const normalized = body.replaceAll("\r\n", "\n").trim();
  if (!normalized) return "";

  const firstLine = normalized.split("\n")[0] ?? "";
  const cleanedFirstLine = stripLeadMarkdownPrefix(firstLine).trim();

  const minLen = 12;
  const base =
    cleanedFirstLine.length >= minLen
      ? cleanedFirstLine
      : stripLeadMarkdownPrefix(normalized).replaceAll(/\s+/g, " ").trim();

  return truncateNicely(base, { minLen, targetLen: 48, hardMax: 80 });
}

function toTitle(arg: Argument): string {
  const title = arg.title?.trim() ?? "";
  if (title) return title;

  const extracted = extractLeadSentence(arg.body);
  if (extracted) return extracted;
  return arg.id;
}

function toExcerpt(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function plainTextToTiptapDoc(text: string): TiptapDoc {
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");

  const blocks: Array<Record<string, unknown>> = [];
  let inline: Array<Record<string, unknown>> = [];

  const flush = () => {
    blocks.push({ type: "paragraph", content: inline.length ? inline : [] });
    inline = [];
  };

  for (const line of lines) {
    if (!line) {
      if (inline.length) flush();
      continue;
    }

    if (inline.length) inline.push({ type: "hardBreak" });
    inline.push({ type: "text", text: line });
  }

  if (inline.length || blocks.length === 0) flush();
  return { type: "doc", content: blocks } as TiptapDoc;
}

function formatSavedTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toFriendlyMessage(
  t: (key: string, params?: Record<string, string | number>) => string,
  error: ApiError,
): string {
  if (error.kind === "http") {
    if (error.status === 402 || error.code === "INSUFFICIENT_BALANCE") {
      return t("errors.insufficientBalance");
    }
    if (error.status === 401 && error.code === "INVALID_SIGNATURE") {
      return t("errors.invalidSignature");
    }
  }
  return error.message;
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function RichTextToolbar({
  editor,
  onRequestHideToolbar,
}: {
  editor: Editor | null;
  onRequestHideToolbar?: () => void;
}) {
  if (!editor) return null;
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 w-8 p-0 border border-border bg-background",
          editor.isActive("bold") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-label={t("editor.bold")}
      >
        B
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 w-8 p-0 border border-border bg-background italic",
          editor.isActive("italic") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-label={t("editor.italic")}
      >
        I
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 w-8 p-0 border border-border bg-background underline",
          editor.isActive("underline") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        aria-label={t("editor.underline")}
      >
        U
      </Button>

      <div className="mx-1 h-4 w-px bg-border/80" />

      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("heading", { level: 2 }) ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-label={t("editor.heading2")}
      >
        H2
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("heading", { level: 3 }) ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-label={t("editor.heading3")}
      >
        H3
      </Button>

      <div className="mx-1 h-4 w-px bg-border/80" />

      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("bulletList") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        aria-label={t("editor.bulletList")}
      >
        •
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("orderedList") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        aria-label={t("editor.orderedList")}
      >
        1.
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("blockquote") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        aria-label={t("editor.quote")}
      >
        “
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background font-mono",
          editor.isActive("codeBlock") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        aria-label={t("editor.codeBlock")}
      >
        {"</>"}
      </Button>

      <div className="mx-1 h-4 w-px bg-border/80" />

      <Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("link") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => {
          const previousUrl = editor.getAttributes("link").href as string | undefined;
          const nextUrl = window.prompt(t("editor.linkUrlPrompt"), previousUrl ?? "");
          if (nextUrl === null) return;
          const trimmed = nextUrl.trim();
          if (!trimmed) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
        }}
        aria-label={t("editor.link")}
      >
        ↗
      </Button>
      </div>

      {onRequestHideToolbar ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-3 border border-border bg-background"
          onClick={onRequestHideToolbar}
          aria-label={t("stage.hideToolbarAria")}
        >
          {t("common.hide")}
        </Button>
      ) : null}
    </div>
  );
}

function VoteStepper(props: {
  topicId: string;
  argument: Argument;
  topicStatus: "active" | "frozen" | "archived";
  ledger: LedgerMe | null;
  currentVotes: number;
  onLedgerUpdated: (ledger: LedgerMe) => void;
  onVotesUpdated: (votes: number) => void;
  onInvalidate: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [targetVotes, setTargetVotes] = useState(props.currentVotes);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setTargetVotes(props.currentVotes);
    setSubmitError("");
  }, [props.argument.id, props.currentVotes]);

  const currentCost = props.currentVotes * props.currentVotes;
  const targetCost = targetVotes * targetVotes;
  const deltaCost = targetCost - currentCost;

  const increaseForbidden =
    props.topicStatus !== "active" || Boolean(props.argument.prunedAt);
  const isIncrease = targetVotes > props.currentVotes;
  const disableSubmit = isSubmitting || (increaseForbidden && isIncrease);

  const availableBalance = props.ledger?.balance ?? null;

  const setByDelta = (delta: number) => {
    setSubmitError("");
    const next = Math.min(10, Math.max(0, targetVotes + delta));

    if (increaseForbidden && next > props.currentVotes) {
      toast({
        variant: "warn",
        title: t("dialogue.readOnlyTitle"),
        message: props.argument.prunedAt ? t("dialogue.nodePruned") : t("dialogue.topicReadOnly"),
      });
      return;
    }

    if (availableBalance !== null) {
      const nextCost = next * next;
      const nextDeltaCost = nextCost - currentCost;
      if (nextDeltaCost > availableBalance) {
        toast({ variant: "error", title: t("dialogue.votes"), message: t("errors.insufficientBalance") });
        return;
      }
    }

    setTargetVotes(next);
  };

  const submit = async () => {
    setSubmitError("");
    setIsSubmitting(true);
    const result = await apiClient.setVotes(props.topicId, props.argument.id, {
      targetVotes,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(toFriendlyMessage(t, result.error));
      return;
    }

    props.onLedgerUpdated(result.data.ledger);
    props.onVotesUpdated(result.data.targetVotes);
    props.onInvalidate();
    toast({ variant: "success", title: t("dialogue.votes"), message: t("stage.votesRecorded") });
  };

  return (
    <div className="border-t border-border/60 bg-[color:var(--muted)] px-6 py-4">
	        <div className="flex flex-wrap items-center justify-between gap-4">
	          <div className="flex flex-wrap items-center gap-4">
	          <span className="text-sm text-muted-foreground">{t("stage.supportLabel")}:</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 border border-border bg-background"
              onClick={() => setByDelta(-1)}
              disabled={targetVotes === 0 || isSubmitting}
              aria-label={t("stage.decreaseVotes")}
            >
              −
            </Button>
            <div className="w-10 text-center">
              <span className="text-lg font-medium text-foreground">{targetVotes}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 border border-border bg-background"
              onClick={() => setByDelta(1)}
              disabled={targetVotes === 10 || isSubmitting}
              aria-label={t("stage.increaseVotes")}
            >
              +
            </Button>
          </div>

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>
              {t("dialogue.cost")}: {targetCost} ({t("dialogue.deltaCost")}: {formatDelta(deltaCost)})
            </span>
            {availableBalance !== null ? (
              <span>
                {t("dialogue.balance")}: {availableBalance}
              </span>
            ) : null}
          </div>
        </div>

        <Button
          size="sm"
          variant="ink"
          onClick={submit}
          disabled={disableSubmit || targetVotes === props.currentVotes}
        >
          {isSubmitting ? t("common.saving") : t("stage.confirmVotes")}
        </Button>
      </div>

      {increaseForbidden ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {props.argument.prunedAt ? t("dialogue.nodePruned") : t("dialogue.topicReadOnly")}
        </p>
      ) : null}

      {submitError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}

export function TopicStage({ topicId }: Props) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const visitedStore = useMemo(() => createLocalStorageVisitedTopicsStore(), []);
  const claimTokenStore = useMemo(() => createLocalStorageClaimTokenStore(), []);
  const draftStore = useMemo(() => createLocalStorageDraftStore(), []);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const readerContentRef = useRef<HTMLDivElement | null>(null);

  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_LEFT_PANE_WIDTH;
    try {
      const raw = window.localStorage.getItem(LEFT_PANE_WIDTH_STORAGE_KEY);
      if (!raw) return DEFAULT_LEFT_PANE_WIDTH;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return DEFAULT_LEFT_PANE_WIDTH;
      return Math.min(MAX_LEFT_PANE_WIDTH, Math.max(MIN_LEFT_PANE_WIDTH, parsed));
    } catch {
      return DEFAULT_LEFT_PANE_WIDTH;
    }
  });

  const [relatedPaneWidth, setRelatedPaneWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_RELATED_PANE_WIDTH;
    try {
      const raw = window.localStorage.getItem(RELATED_PANE_WIDTH_STORAGE_KEY);
      if (!raw) return DEFAULT_RELATED_PANE_WIDTH;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return DEFAULT_RELATED_PANE_WIDTH;
      return Math.min(MAX_RELATED_PANE_WIDTH, Math.max(MIN_RELATED_PANE_WIDTH, parsed));
    } catch {
      return DEFAULT_RELATED_PANE_WIDTH;
    }
  });
  const [isLeftPaneHoverExpanded, setIsLeftPaneHoverExpanded] = useState(false);

  const clampLeftPaneWidth = useCallback(
    (nextWidth: number) => {
      const fallback = DEFAULT_LEFT_PANE_WIDTH;
      const desired = Number.isFinite(nextWidth) ? nextWidth : fallback;

      if (typeof window === "undefined") {
        return Math.min(MAX_LEFT_PANE_WIDTH, Math.max(MIN_LEFT_PANE_WIDTH, desired));
      }

      const containerRect = stageRef.current?.getBoundingClientRect();
      const containerWidth =
        containerRect && containerRect.width > 0 ? containerRect.width : window.innerWidth;

      const isLg = window.innerWidth >= 1024;
      const resizerWidth = PANE_RESIZER_WIDTH;
      const minCenterWidth = MIN_CENTER_PANE_WIDTH;
      const minRightWidth = isLg ? relatedPaneWidth + minCenterWidth + resizerWidth : minCenterWidth;
      const maxByContainer = containerWidth - resizerWidth - minRightWidth;
      const maxAllowed = Math.min(MAX_LEFT_PANE_WIDTH, Math.max(MIN_LEFT_PANE_WIDTH, maxByContainer));
      const minAllowed = Math.min(MIN_LEFT_PANE_WIDTH, maxAllowed);

      return Math.min(maxAllowed, Math.max(minAllowed, desired));
    },
    [relatedPaneWidth],
  );

  const leftPaneDisplayWidth = isLeftPaneHoverExpanded
    ? clampLeftPaneWidth(Math.max(leftPaneWidth, LEFT_PANE_HOVER_EXPANDED_WIDTH))
    : leftPaneWidth;

  const clampRelatedPaneWidth = useCallback(
    (nextWidth: number) => {
      const fallback = DEFAULT_RELATED_PANE_WIDTH;
      const desired = Number.isFinite(nextWidth) ? nextWidth : fallback;

      if (typeof window === "undefined") {
        return Math.min(MAX_RELATED_PANE_WIDTH, Math.max(MIN_RELATED_PANE_WIDTH, desired));
      }

      const isLg = window.innerWidth >= 1024;
      if (!isLg) {
        return Math.min(MAX_RELATED_PANE_WIDTH, Math.max(MIN_RELATED_PANE_WIDTH, desired));
      }

      const containerRect = stageRef.current?.getBoundingClientRect();
      const containerWidth =
        containerRect && containerRect.width > 0 ? containerRect.width : window.innerWidth;

      const resizerWidth = PANE_RESIZER_WIDTH;
      const minCenterWidth = MIN_CENTER_PANE_WIDTH;
      const availableForRelated = containerWidth - leftPaneWidth - resizerWidth * 2 - minCenterWidth;
      const maxAllowed = Math.min(
        MAX_RELATED_PANE_WIDTH,
        Math.max(MIN_RELATED_PANE_WIDTH, availableForRelated),
      );
      const minAllowed = Math.min(MIN_RELATED_PANE_WIDTH, maxAllowed);

      return Math.min(maxAllowed, Math.max(minAllowed, desired));
    },
    [leftPaneWidth],
  );

  useEffect(() => {
    setLeftPaneWidth((prev) => clampLeftPaneWidth(prev));
  }, [clampLeftPaneWidth]);

  useEffect(() => {
    setRelatedPaneWidth((prev) => clampRelatedPaneWidth(prev));
  }, [clampRelatedPaneWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LEFT_PANE_WIDTH_STORAGE_KEY, String(leftPaneWidth));
    } catch {
      // ignore
    }
  }, [leftPaneWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(RELATED_PANE_WIDTH_STORAGE_KEY, String(relatedPaneWidth));
    } catch {
      // ignore
    }
  }, [relatedPaneWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev));
      setRelatedPaneWidth((prev) => clampRelatedPaneWidth(prev));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampLeftPaneWidth, clampRelatedPaneWidth]);

  type ResizeSession =
    | { kind: "left"; startX: number; startWidth: number }
    | { kind: "related"; startX: number; startWidth: number };

  const resizeSessionRef = useRef<ResizeSession | null>(null);

  const stopResizing = useCallback(() => {
    resizeSessionRef.current = null;
    try {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePointerMove = (event: PointerEvent) => {
      const session = resizeSessionRef.current;
      if (!session) return;

      if (session.kind === "left") {
        const nextWidth = session.startWidth + (event.clientX - session.startX);
        setLeftPaneWidth(clampLeftPaneWidth(nextWidth));
        return;
      }

      const nextWidth = session.startWidth - (event.clientX - session.startX);
      setRelatedPaneWidth(clampRelatedPaneWidth(nextWidth));
    };

    const handlePointerUp = () => {
      if (!resizeSessionRef.current) return;
      stopResizing();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      stopResizing();
    };
  }, [clampLeftPaneWidth, clampRelatedPaneWidth, stopResizing]);

  const startResizingLeft = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      resizeSessionRef.current = { kind: "left", startX: event.clientX, startWidth: leftPaneDisplayWidth };
      if (leftPaneDisplayWidth !== leftPaneWidth) {
        setLeftPaneWidth(leftPaneDisplayWidth);
      }
      setIsLeftPaneHoverExpanded(false);

      try {
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      } catch {
        // ignore
      }
    },
    [leftPaneDisplayWidth, leftPaneWidth],
  );

  const startResizingRelated = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      resizeSessionRef.current = { kind: "related", startX: event.clientX, startWidth: relatedPaneWidth };

      try {
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      } catch {
        // ignore
      }
    },
    [relatedPaneWidth],
  );

  const [leftColumnWidth, setLeftColumnWidth] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = leftColumnRef.current;
    if (!el) return;

    const update = () => setLeftColumnWidth(el.getBoundingClientRect().width);
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);
  const [identityFingerprint, setIdentityFingerprint] = useState<string | null>(null);
  const [identityPubkeyHex, setIdentityPubkeyHex] = useState<string | null>(null);
  const [myAuthorId, setMyAuthorId] = useState<string | null>(null);
  const [topicDisplayName, setTopicDisplayName] = useState("");
  const topicDisplayNameRef = useRef(topicDisplayName);
  topicDisplayNameRef.current = topicDisplayName;
  const topicDisplayNameDirtyRef = useRef(false);
  const topicDisplayNameServerRef = useRef("");
  const topicDisplayNameSaveTimerRef = useRef<number | null>(null);
  const topicDisplayNameSaveSeqRef = useRef(0);
  type TopicDisplayNameSaveState =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string };
  const [topicDisplayNameSave, setTopicDisplayNameSave] = useState<TopicDisplayNameSaveState>({
    kind: "idle",
  });

  const [refreshToken, setRefreshToken] = useState(0);
  const invalidate = useCallback(() => setRefreshToken((prev) => prev + 1), []);

  const [reloadRequired, setReloadRequired] = useState(false);
  const handleReloadRequired = useCallback(() => setReloadRequired(true), []);

  // Private topic share links use URL hash (#k=...) so the secret isn't sent to the server.
  // On first load, store the key locally and then clear the hash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    if (!raw) return;

    const params = new URLSearchParams(raw);
    const accessKey = params.get("k");
    if (!accessKey) return;

    try {
      createLocalStorageTopicAccessKeyStore().set(topicId, accessKey);
    } catch {
      return;
    }

    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      // ignore
    }
  }, [topicId]);

  useTopicSse({
    topicId,
    debounceMs: 3000,
    onInvalidation: invalidate,
    onReloadRequired: handleReloadRequired,
  });

  const tree = useTopicTree(topicId, 10, refreshToken, { loadFullTree: true });
  const topicStatus = tree.status === "success" ? tree.topic.status : "active";

  const argFromUrl = searchParams.get("arg");
  const [selectedArgumentId, setSelectedArgumentId] = useState<string | null>(() => argFromUrl || null);
  const [selectedArgumentDetail, setSelectedArgumentDetail] = useState<Argument | null>(null);
  const [selectedArgumentDetailError, setSelectedArgumentDetailError] = useState("");
  const [isLoadingSelectedArgumentDetail, setIsLoadingSelectedArgumentDetail] = useState(false);
  const [hoverCard, setHoverCard] = useState<HoverCardState | null>(null);
  const hoverCardRef = useRef<HoverCardState | null>(null);
  hoverCardRef.current = hoverCard;
  const hoverCardHoverIdRef = useRef<string | null>(null);
  const hoverCardPendingRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const hoverCardShowTimerRef = useRef<number | null>(null);
  const hoverCardHideTimerRef = useRef<number | null>(null);
  const [relatedHoverId, setRelatedHoverId] = useState<string | null>(null);
  type RelatedSimilarItem = { argumentId: string; similarity: number };
  const [relatedSimilarItems, setRelatedSimilarItems] = useState<RelatedSimilarItem[]>([]);
  const [relatedSimilarStatus, setRelatedSimilarStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [relatedSimilarError, setRelatedSimilarError] = useState("");
  const [isMobileRelatedOpen, setIsMobileRelatedOpen] = useState(false);
  const [quoteHint, setQuoteHint] = useState<{ text: string; x: number; y: number } | null>(null);
  const selectedArgumentIdRef = useRef<string | null>(null);
  selectedArgumentIdRef.current = selectedArgumentId;

  const clearHoverCardTimers = useCallback(() => {
    if (hoverCardShowTimerRef.current !== null) {
      window.clearTimeout(hoverCardShowTimerRef.current);
      hoverCardShowTimerRef.current = null;
    }
    if (hoverCardHideTimerRef.current !== null) {
      window.clearTimeout(hoverCardHideTimerRef.current);
      hoverCardHideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearHoverCardTimers();
    };
  }, [clearHoverCardTimers]);

  const isRightComposerFocused = useCallback(() => {
    if (typeof document === "undefined") return false;

    const active = document.activeElement;
    const root = rightColumnRef.current;
    if (!active || !root) return false;
    if (!root.contains(active)) return false;

    const el = active as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute("role") === "textbox") return true;
    if (el.closest("[contenteditable='true']")) return true;
    return false;
  }, []);

  const [isEditingSelectedArgument, setIsEditingSelectedArgument] = useState(false);
  const [isEditEditorMode, setIsEditEditorMode] = useState(true);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isEditDirty, setIsEditDirty] = useState(false);
  const isSeedingEditRef = useRef(false);
  const isEditDirtyRef = useRef(false);
  const shouldFocusEditRef = useRef(false);
  const submitEditRef = useRef<(() => void) | null>(null);
  const isEditingSelectedArgumentRef = useRef(false);
  isEditingSelectedArgumentRef.current = isEditingSelectedArgument;
  const isSavingEditRef = useRef(false);
  isSavingEditRef.current = isSavingEdit;

  const confirmDiscardEdits = useCallback((message: string): boolean => {
    try {
      return window.confirm(message);
    } catch {
      return true;
    }
  }, []);

  const requestSelectArgumentId = useCallback(
    (nextId: string | null) => {
      if (isSavingEditRef.current) return;

      const currentId = selectedArgumentIdRef.current;
      const isEditing = isEditingSelectedArgumentRef.current;
      if (isEditing && isEditDirtyRef.current && nextId !== currentId) {
        const ok = confirmDiscardEdits(t("stage.confirmLeaveEdit"));
        if (!ok) return;
      }

      if (isEditing) {
        isEditDirtyRef.current = false;
        setIsEditDirty(false);
        shouldFocusEditRef.current = false;
        setIsEditingSelectedArgument(false);
        setEditError("");
        setIsSavingEdit(false);
      }

      setSelectedArgumentId(nextId);
    },
    [confirmDiscardEdits],
  );

  const requestSelectArgumentIdRef = useRef(requestSelectArgumentId);
  requestSelectArgumentIdRef.current = requestSelectArgumentId;

  // Keep URL arg=<argumentId> in sync with selection (and support deep-links).
  useEffect(() => {
    const next = argFromUrl || null;
    if (next === selectedArgumentIdRef.current) return;
    requestSelectArgumentIdRef.current(next);
  }, [argFromUrl]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const current = params.get("arg");

    if (selectedArgumentIdRef.current) {
      if (current === selectedArgumentIdRef.current) return;
      params.set("arg", selectedArgumentIdRef.current);
    } else {
      if (!current) return;
      params.delete("arg");
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router, searchParams, selectedArgumentId]);

  useEffect(() => {
    if (!isEditingSelectedArgument) return;
    if (!isEditDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditDirty, isEditingSelectedArgument]);

  const [ledger, setLedger] = useState<LedgerMe | null>(null);
  const [ledgerError, setLedgerError] = useState("");

  const [stakesByArgumentId, setStakesByArgumentId] = useState<Record<string, number>>({});
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);

  const authorLabel = useCallback(
    (authorId: string, authorDisplayName?: string | null) => {
      const custom = topicDisplayName.trim();
      if (myAuthorId && authorId === myAuthorId && custom) return custom;
      const published = authorDisplayName?.trim();
      if (published) return published;
      return pseudonymFromAuthorId(authorId, locale);
    },
    [locale, myAuthorId, topicDisplayName],
  );

  const handleTopicDisplayNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    topicDisplayNameDirtyRef.current = true;
    setTopicDisplayNameSave((prev) => (prev.kind === "error" ? { kind: "idle" } : prev));
    setTopicDisplayName(event.target.value);
  };

  // Identity presence
  useEffect(() => {
    try {
      setHasIdentity(Boolean(keyStore.getMasterSeedHex()));
    } catch {
      setHasIdentity(false);
    }
  }, [keyStore]);

  // Record this topic as visited (My Activity aggregation)
  useEffect(() => {
    visitedStore.addTopic(topicId);
  }, [topicId, visitedStore]);

  useEffect(() => {
    topicDisplayNameDirtyRef.current = false;
    topicDisplayNameServerRef.current = "";
    topicDisplayNameSaveSeqRef.current += 1;
    if (topicDisplayNameSaveTimerRef.current !== null) {
      window.clearTimeout(topicDisplayNameSaveTimerRef.current);
      topicDisplayNameSaveTimerRef.current = null;
    }
    setTopicDisplayName("");
    setTopicDisplayNameSave({ kind: "idle" });
  }, [topicId]);

  useEffect(() => {
    if (hasIdentity === true) return;
    topicDisplayNameDirtyRef.current = false;
    topicDisplayNameServerRef.current = "";
    topicDisplayNameSaveSeqRef.current += 1;
    if (topicDisplayNameSaveTimerRef.current !== null) {
      window.clearTimeout(topicDisplayNameSaveTimerRef.current);
      topicDisplayNameSaveTimerRef.current = null;
    }
    setTopicDisplayName("");
    setTopicDisplayNameSave({ kind: "idle" });
  }, [hasIdentity]);

  useEffect(() => {
    return () => {
      topicDisplayNameSaveSeqRef.current += 1;
      if (topicDisplayNameSaveTimerRef.current !== null) {
        window.clearTimeout(topicDisplayNameSaveTimerRef.current);
        topicDisplayNameSaveTimerRef.current = null;
      }
    };
  }, []);

  // Derive topic identity fingerprint
  useEffect(() => {
    if (!hasIdentity) {
      setIdentityFingerprint(null);
      setIdentityPubkeyHex(null);
      setMyAuthorId(null);
      return;
    }

    const masterSeedHex = keyStore.getMasterSeedHex();
    if (!masterSeedHex) {
      setIdentityFingerprint(null);
      setIdentityPubkeyHex(null);
      setMyAuthorId(null);
      return;
    }

    const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(masterSeedHex, topicId);
    setIdentityFingerprint(`${pubkeyHex.slice(0, 6)}…${pubkeyHex.slice(-6)}`);
    setIdentityPubkeyHex(pubkeyHex);
  }, [hasIdentity, keyStore, topicId]);

  // Derive current topic authorId (sha256(pubkey).slice(0,16))
  useEffect(() => {
    if (!identityPubkeyHex) {
      setMyAuthorId(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const authorId = await authorIdFromPubkeyHex(identityPubkeyHex);
        if (cancelled) return;
        setMyAuthorId(authorId);
      } catch {
        if (cancelled) return;
        setMyAuthorId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identityPubkeyHex]);

  // Topic-scoped display name (server-stored, autosaved)
  useEffect(() => {
    if (hasIdentity !== true) return;
    if (topicDisplayNameSaveTimerRef.current !== null) {
      window.clearTimeout(topicDisplayNameSaveTimerRef.current);
      topicDisplayNameSaveTimerRef.current = null;
    }

    if (!topicDisplayNameDirtyRef.current) return;

    const desired = topicDisplayName.trim() ? topicDisplayName.trim() : null;
    const onServer = topicDisplayNameServerRef.current.trim()
      ? topicDisplayNameServerRef.current.trim()
      : null;

    if (desired === onServer) {
      setTopicDisplayNameSave({ kind: "idle" });
      return;
    }

    setTopicDisplayNameSave({ kind: "saving" });
    const requestId = (topicDisplayNameSaveSeqRef.current += 1);

    topicDisplayNameSaveTimerRef.current = window.setTimeout(() => {
      topicDisplayNameSaveTimerRef.current = null;

      (async () => {
        const latestDesired = topicDisplayNameRef.current.trim()
          ? topicDisplayNameRef.current.trim()
          : null;
        const serverNow = topicDisplayNameServerRef.current.trim()
          ? topicDisplayNameServerRef.current.trim()
          : null;

        if (latestDesired === serverNow) {
          setTopicDisplayNameSave({ kind: "idle" });
          return;
        }

        const result = await apiClient.setTopicProfileMe(topicId, { displayName: latestDesired });
        if (topicDisplayNameSaveSeqRef.current !== requestId) return;

        if (!result.ok) {
          setTopicDisplayNameSave({ kind: "error", message: toFriendlyMessage(t, result.error) });
          return;
        }

        const saved = result.data.displayName ?? "";
        topicDisplayNameServerRef.current = saved;
        if ((topicDisplayNameRef.current.trim() || "") === saved) {
          topicDisplayNameDirtyRef.current = false;
        }

        setTopicDisplayNameSave({ kind: "saved" });
        invalidate();
        window.setTimeout(() => {
          setTopicDisplayNameSave((prev) => (prev.kind === "saved" ? { kind: "idle" } : prev));
        }, 1400);
      })();
    }, 650);

    return () => {
      if (topicDisplayNameSaveTimerRef.current !== null) {
        window.clearTimeout(topicDisplayNameSaveTimerRef.current);
        topicDisplayNameSaveTimerRef.current = null;
      }
    };
  }, [hasIdentity, invalidate, topicDisplayName, topicId]);

  // Ledger
  useEffect(() => {
    if (!hasIdentity) {
      setLedger(null);
      setLedgerError("");
      return;
    }

    let cancelled = false;
    setLedger(null);
    setLedgerError("");

    (async () => {
      const result = await apiClient.getLedgerMe(topicId);
      if (cancelled) return;

      if (!result.ok) {
        setLedgerError(result.error.message);
        return;
      }

      setLedger(result.data);

      const nextDisplayName = result.data.displayName ?? "";
      topicDisplayNameServerRef.current = nextDisplayName;
      if (!topicDisplayNameDirtyRef.current) {
        setTopicDisplayName(nextDisplayName);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasIdentity, topicId]);

  // Stakes (votes per argument for current identity)
  useEffect(() => {
    if (!hasIdentity) {
      setStakesByArgumentId({});
      return;
    }

    let cancelled = false;

    (async () => {
      const result = await apiClient.getStakesMe(topicId);
      if (cancelled) return;
      if (!result.ok) return;

      const next: Record<string, number> = {};
      for (const item of result.data.items) {
        next[item.argumentId] = item.votes;
      }
      setStakesByArgumentId(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [hasIdentity, topicId]);

  const argumentById = useMemo(() => {
    if (tree.status !== "success") return new Map<string, Argument>();
    return new Map(tree.arguments.map((arg) => [arg.id, arg]));
  }, [tree]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, Argument[]>();
    if (tree.status !== "success") return map;

    for (const arg of tree.arguments) {
      const parentId = arg.parentId;
      if (!parentId) continue;
      const list = map.get(parentId);
      if (list) {
        list.push(arg);
      } else {
        map.set(parentId, [arg]);
      }
    }

    return map;
  }, [tree]);

  const rootArgumentId = tree.status === "success" ? tree.topic.rootArgumentId : null;
  const readArgumentId = selectedArgumentId ?? rootArgumentId;

  // Fetch full argument detail (includes bodyRich) for the reader/edit flows.
  useEffect(() => {
    if (!readArgumentId) {
      setSelectedArgumentDetail(null);
      setSelectedArgumentDetailError("");
      setIsLoadingSelectedArgumentDetail(false);
      return;
    }

    let cancelled = false;
    setSelectedArgumentDetail(null);
    setSelectedArgumentDetailError("");
    setIsLoadingSelectedArgumentDetail(true);

    (async () => {
      const result = await apiClient.getArgument(readArgumentId, topicId);
      if (cancelled) return;
      setIsLoadingSelectedArgumentDetail(false);

      if (!result.ok) {
        setSelectedArgumentDetailError(result.error.message);
        setSelectedArgumentDetail(null);
        return;
      }

      setSelectedArgumentDetail(result.data.argument);
    })();

    return () => {
      cancelled = true;
    };
  }, [readArgumentId, refreshToken, topicId]);

  useEffect(() => {
    setIsEditingSelectedArgument(false);
    isEditDirtyRef.current = false;
    setIsEditDirty(false);
    shouldFocusEditRef.current = false;
    setEditError("");
    setIsSavingEdit(false);
    setEditTitle("");
  }, [selectedArgumentId]);

  const readArgument = useMemo(() => {
    if (!readArgumentId) return null;
    if (selectedArgumentDetail?.id === readArgumentId) return selectedArgumentDetail;
    return argumentById.get(readArgumentId) ?? null;
  }, [argumentById, readArgumentId, selectedArgumentDetail]);

  useEffect(() => {
    if (!readArgument) {
      setRelatedSimilarItems([]);
      setRelatedSimilarStatus("idle");
      setRelatedSimilarError("");
      return;
    }

    if (readArgument.analysisStatus !== "ready") {
      setRelatedSimilarItems([]);
      setRelatedSimilarStatus("idle");
      setRelatedSimilarError("");
      return;
    }

    let cancelled = false;
    setRelatedSimilarStatus("loading");
    setRelatedSimilarError("");

    (async () => {
      const result = await apiClient.getArgumentRelated({ topicId, argumentId: readArgument.id, limit: 10 });
      if (cancelled) return;

      if (!result.ok) {
        setRelatedSimilarStatus("error");
        setRelatedSimilarError(result.error.message);
        setRelatedSimilarItems([]);
        return;
      }

      setRelatedSimilarStatus("success");
      setRelatedSimilarItems(result.data.items);
    })();

    return () => {
      cancelled = true;
    };
  }, [readArgument?.analysisStatus, readArgument?.id, refreshToken, topicId]);

  const related = useMemo(() => {
    if (!readArgument) return null;

    const chain: Argument[] = [];
    const visited = new Set<string>();
    let current: Argument | null = readArgument;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      if (!current.parentId) break;
      current = argumentById.get(current.parentId) ?? null;
    }

    chain.reverse();

    const compareByVotesThenCreatedAt = (a: Argument, b: Argument) => {
      if (a.totalVotes !== b.totalVotes) return b.totalVotes - a.totalVotes;
      const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    };

    const ancestors = chain.slice(0, -1).reverse();

    const siblings =
      readArgument.parentId !== null && readArgument.parentId !== undefined
        ? [...(childrenByParentId.get(readArgument.parentId) ?? [])]
            .filter((arg) => arg.id !== readArgument.id)
            .sort(compareByVotesThenCreatedAt)
        : [];

    const children = [...(childrenByParentId.get(readArgument.id) ?? [])].sort(compareByVotesThenCreatedAt);

    return { ancestors, siblings, children };
  }, [argumentById, childrenByParentId, readArgument]);

  const relatedSimilar = useMemo(() => {
    return relatedSimilarItems
      .map((item) => {
        const arg = argumentById.get(item.argumentId);
        if (!arg) return null;
        return { arg, similarity: item.similarity };
      })
      .filter((row): row is { arg: Argument; similarity: number } => row !== null);
  }, [argumentById, relatedSimilarItems]);

  const relatedHoverArgument = useMemo(() => {
    if (!relatedHoverId) return null;
    return argumentById.get(relatedHoverId) ?? null;
  }, [argumentById, relatedHoverId]);

  const relatedNavigationSequence = useMemo(() => {
    if (!readArgument) return [];
    if (!related) return [];

    const sequence: Array<string | null> = [];
    const seen = new Set<string>();
    const push = (id: string | null) => {
      const key = id ?? "__ROOT__";
      if (seen.has(key)) return;
      seen.add(key);
      sequence.push(id);
    };

    for (const arg of [...related.ancestors].reverse()) {
      push(rootArgumentId !== null && arg.id === rootArgumentId ? null : arg.id);
    }

    const canonicalSelectedId =
      rootArgumentId !== null && selectedArgumentId === rootArgumentId ? null : selectedArgumentId ?? null;
    push(canonicalSelectedId);

    for (const item of relatedSimilarItems) {
      push(rootArgumentId !== null && item.argumentId === rootArgumentId ? null : item.argumentId);
    }

    for (const arg of related.children) {
      push(arg.id);
    }

    for (const arg of related.siblings) {
      push(arg.id);
    }

    return sequence;
  }, [readArgument, related, relatedSimilarItems, rootArgumentId, selectedArgumentId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isRightComposerFocused()) return;
      if (relatedNavigationSequence.length <= 1) return;

      const canonicalSelectedId =
        rootArgumentId !== null && selectedArgumentId === rootArgumentId ? null : selectedArgumentId ?? null;
      const currentIndex = relatedNavigationSequence.indexOf(canonicalSelectedId);
      if (currentIndex === -1) return;

      const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= relatedNavigationSequence.length) return;

      event.preventDefault();
      setRelatedHoverId(null);
      requestSelectArgumentIdRef.current(relatedNavigationSequence[nextIndex]);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isRightComposerFocused, relatedNavigationSequence, rootArgumentId, selectedArgumentId]);

  const canEditSelectedArgument =
    hasIdentity === true &&
    topicStatus === "active" &&
    myAuthorId !== null &&
    readArgument !== null &&
    readArgument.authorId === myAuthorId;

  const startEditingSelectedArgument = useCallback(() => {
    if (!canEditSelectedArgument) return;
    if (isSavingEdit) return;
    isEditDirtyRef.current = false;
    setIsEditDirty(false);
    shouldFocusEditRef.current = true;
    setEditError("");
    setIsEditEditorMode(true);
    setIsEditingSelectedArgument(true);
  }, [canEditSelectedArgument, isSavingEdit]);

  const cancelEditingSelectedArgument = useCallback(() => {
    if (!isEditingSelectedArgument) return;
    if (isSavingEdit) return;
    if (isEditDirtyRef.current) {
      const ok = confirmDiscardEdits(t("stage.confirmCancelEdit"));
      if (!ok) return;
    }

    isEditDirtyRef.current = false;
    setIsEditDirty(false);
    shouldFocusEditRef.current = false;
    setEditError("");
    setIsSavingEdit(false);
    setIsEditingSelectedArgument(false);
  }, [confirmDiscardEdits, isEditingSelectedArgument, isSavingEdit]);

  const hasRestoredReplySelectionRef = useRef(false);
  const hasAutoOpenedManageRef = useRef(false);

  useEffect(() => {
    if (hasRestoredReplySelectionRef.current) return;
    if (tree.status !== "success") return;

    try {
      const lastParentId = draftStore.getReplyMeta(topicId)?.lastParentId ?? null;
      if (lastParentId && argumentById.has(lastParentId)) {
        requestSelectArgumentId(lastParentId);
      }
    } catch {
      // ignore
    }

    setIsReplyDraftHydrated(true);
    hasRestoredReplySelectionRef.current = true;
  }, [argumentById, draftStore, requestSelectArgumentId, topicId, tree.status]);

  const isOwner =
    hasIdentity === true &&
    identityPubkeyHex !== null &&
    tree.status === "success" &&
    tree.topic.ownerPubkey !== null &&
    identityPubkeyHex === tree.topic.ownerPubkey;

  useEffect(() => {
    if (hasAutoOpenedManageRef.current) return;

    const wantsManage = searchParams.get("manage");
    if (wantsManage !== "1" && wantsManage !== "true") return;
    if (!isOwner) return;

    hasAutoOpenedManageRef.current = true;
    setIsManageOpen(true);
  }, [isOwner, searchParams]);

  const sunburstTree = useMemo(() => {
    if (tree.status !== "success") return null;

    const nodes = tree.arguments.map((arg) => ({
      id: arg.id,
      parentId: arg.parentId,
      label: toTitle(arg),
      value: Math.max(1, arg.totalVotes + 1),
    }));

    return buildSunburstTreeFromFlatNodes(nodes, tree.topic.rootArgumentId);
  }, [tree]);

  const showHoverCard = useCallback(
    (input: { id: string; x: number; y: number }) => {
      const arg = argumentById.get(input.id);
      if (!arg) {
        setHoverCard(null);
        return;
      }

      if (hoverCardHideTimerRef.current !== null) {
        window.clearTimeout(hoverCardHideTimerRef.current);
        hoverCardHideTimerRef.current = null;
      }

      setHoverCard({ argument: arg, x: input.x, y: input.y });
    },
    [argumentById],
  );

  const hideHoverCard = useCallback(
    (options?: { immediate?: boolean }) => {
      const immediate = options?.immediate ?? false;

      if (hoverCardShowTimerRef.current !== null) {
        window.clearTimeout(hoverCardShowTimerRef.current);
        hoverCardShowTimerRef.current = null;
      }

      hoverCardPendingRef.current = null;
      hoverCardHoverIdRef.current = null;

      if (immediate) {
        if (hoverCardHideTimerRef.current !== null) {
          window.clearTimeout(hoverCardHideTimerRef.current);
          hoverCardHideTimerRef.current = null;
        }
        setHoverCard(null);
        return;
      }

      if (hoverCardHideTimerRef.current !== null) {
        window.clearTimeout(hoverCardHideTimerRef.current);
        hoverCardHideTimerRef.current = null;
      }

      const hideAfterMs = 110;
      hoverCardHideTimerRef.current = window.setTimeout(() => {
        hoverCardHideTimerRef.current = null;
        setHoverCard(null);
      }, hideAfterMs);
    },
    [],
  );

  const handleSunburstHoverChange = useCallback(
    (value: { id: string; pointer: { x: number; y: number } } | null) => {
      if (!value) {
        hideHoverCard();
        return;
      }

      if (hoverCardHideTimerRef.current !== null) {
        window.clearTimeout(hoverCardHideTimerRef.current);
        hoverCardHideTimerRef.current = null;
      }

      hoverCardHoverIdRef.current = value.id;

      const current = hoverCardRef.current;
      if (current && current.argument.id === value.id) {
        return;
      }

      if (current) {
        if (hoverCardShowTimerRef.current !== null) {
          window.clearTimeout(hoverCardShowTimerRef.current);
          hoverCardShowTimerRef.current = null;
        }
        hoverCardPendingRef.current = null;
        showHoverCard({ id: value.id, x: value.pointer.x, y: value.pointer.y });
        return;
      }

      const pending = hoverCardPendingRef.current;
      if (pending && pending.id === value.id && hoverCardShowTimerRef.current !== null) {
        hoverCardPendingRef.current = { id: value.id, x: value.pointer.x, y: value.pointer.y };
        return;
      }

      hoverCardPendingRef.current = { id: value.id, x: value.pointer.x, y: value.pointer.y };

      if (hoverCardShowTimerRef.current !== null) {
        window.clearTimeout(hoverCardShowTimerRef.current);
      }

      const showAfterMs = 150;
      hoverCardShowTimerRef.current = window.setTimeout(() => {
        hoverCardShowTimerRef.current = null;
        const pending = hoverCardPendingRef.current;
        if (!pending) return;
        if (hoverCardHoverIdRef.current !== pending.id) return;
        showHoverCard(pending);
      }, showAfterMs);
    },
    [hideHoverCard, showHoverCard],
  );

  // Hide hover card when entering/leaving read mode
  useEffect(() => {
    setQuoteHint(null);

    if (selectedArgumentId) hideHoverCard({ immediate: true });
  }, [hideHoverCard, selectedArgumentId]);

  useEffect(() => {
    if (!selectedArgumentId) return;
    if (isEditingSelectedArgument) {
      setQuoteHint(null);
      return;
    }

    const clear = () => setQuoteHint(null);

    const handleSelectionChange = () => {
      const container = readerContentRef.current;
      if (!container) {
        clear();
        return;
      }

      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        clear();
        return;
      }

      const text = selection.toString();
      if (!text.trim()) {
        clear();
        return;
      }

      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode) {
        clear();
        return;
      }
      if (!container.contains(anchorNode) || !container.contains(focusNode)) {
        clear();
        return;
      }

      let rect: DOMRect | null = null;
      try {
        rect = selection.getRangeAt(0).getBoundingClientRect();
      } catch {
        rect = null;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        clear();
        return;
      }

      const padding = 12;
      const x = Math.min(window.innerWidth - padding, Math.max(padding, rect.right));
      const y = Math.min(window.innerHeight - padding, Math.max(padding, rect.top));
      setQuoteHint({ text: text.trim(), x, y });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [isEditingSelectedArgument, selectedArgumentId]);

  const sunburstSize = useMemo(() => {
    const width = leftColumnWidth ?? leftPaneDisplayWidth;
    const available = width - 32;
    return Math.max(240, Math.min(360, Math.floor(available)));
  }, [leftColumnWidth, leftPaneDisplayWidth]);

  const cardPosition = (x: number, y: number) => {
    const padding = 16;
    const maxCardWidth = Math.max(180, sunburstSize - padding * 2);
    const cardWidth = Math.min(280, maxCardWidth);

    const maxCardHeight = Math.max(140, sunburstSize - padding * 2);
    const cardHeight = Math.min(180, maxCardHeight);

    let left = x + padding;
    let top = y + padding;

    if (left + cardWidth > sunburstSize) left = x - cardWidth - padding;
    if (top + cardHeight > sunburstSize) top = y - cardHeight - padding;

    left = Math.max(padding, Math.min(left, sunburstSize - cardWidth - padding));
    top = Math.max(padding, Math.min(top, sunburstSize - cardHeight - padding));

    return { left, top, width: cardWidth, height: cardHeight };
  };

  // Reply editor (shared for Explore + Read)
  const [replyTitle, setReplyTitle] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [isReplyEditorMode, setIsReplyEditorMode] = useState(true);
  const [isReplyDraftHydrated, setIsReplyDraftHydrated] = useState(false);
  const replyTitleRef = useRef(replyTitle);
  replyTitleRef.current = replyTitle;

  type AutosaveState =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; savedAt: string }
    | { kind: "error"; message: string };

  const [replyAutosave, setReplyAutosave] = useState<AutosaveState>({ kind: "idle" });
  const replyAutosaveTimerRef = useRef<number | null>(null);
  const replyAutosavePendingRef = useRef<{
    parentId: string;
    selectionId: string | null;
    title: string;
    body: string;
    bodyRich: TiptapDoc | null;
  } | null>(null);
  const skipReplyAutosaveRef = useRef(false);

  const replyDraftParentId = selectedArgumentId ?? rootArgumentId;
  const replyDraftParentIdRef = useRef<string | null>(null);
  replyDraftParentIdRef.current = replyDraftParentId;

  const commitPendingReplyDraft = useCallback((options?: { silent?: boolean }) => {
    if (replyAutosaveTimerRef.current !== null) {
      window.clearTimeout(replyAutosaveTimerRef.current);
      replyAutosaveTimerRef.current = null;
    }

    const pending = replyAutosavePendingRef.current;
    if (!pending) return;
    replyAutosavePendingRef.current = null;

    try {
      const saved = draftStore.setReplyDraft(topicId, pending.parentId, {
        title: pending.title,
        body: pending.body,
        bodyRich: pending.bodyRich,
      });
      draftStore.setReplyMeta(topicId, { lastParentId: pending.selectionId });

      if (!saved) {
        if (!options?.silent) {
          setReplyAutosave({ kind: "idle" });
        }
        return;
      }

      if (!options?.silent) {
        setReplyAutosave({ kind: "saved", savedAt: saved.updatedAt });
      }
    } catch {
      if (!options?.silent) {
        setReplyAutosave({ kind: "error", message: t("errors.localStorageUnavailable") });
      }
    }
  }, [draftStore, t, topicId]);

  const enqueueReplyDraftSave = useCallback(
    (input: { title: string; body: string; bodyRich: TiptapDoc | null }) => {
      if (skipReplyAutosaveRef.current) return;
      const parentId = replyDraftParentIdRef.current;
      if (!parentId) return;

      replyAutosavePendingRef.current = {
        parentId,
        selectionId: selectedArgumentIdRef.current,
        title: input.title,
        body: input.body,
        bodyRich: input.bodyRich,
      };
      setReplyAutosave({ kind: "saving" });

      if (replyAutosaveTimerRef.current !== null) {
        window.clearTimeout(replyAutosaveTimerRef.current);
      }
      replyAutosaveTimerRef.current = window.setTimeout(() => {
        replyAutosaveTimerRef.current = null;
        commitPendingReplyDraft({ silent: false });
      }, 800);
    },
    [commitPendingReplyDraft],
  );

  const canCreateArgument = hasIdentity === true && topicStatus === "active";

  const replyEditor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: t("stage.replyPlaceholder"),
      }),
      Typography,
      Underline,
      TipTapLink.configure({ openOnClick: false }),
    ],
    content: "",
    editorProps: {
      attributes: {
        "aria-label": t("dialogue.replyLabel"),
        class: [
          "w-full min-h-[140px] p-4 text-foreground outline-none",
          "prose prose-base max-w-none",
          "prose-headings:font-serif prose-headings:tracking-tight",
          "prose-a:text-accent prose-a:underline prose-a:decoration-border/70 hover:prose-a:text-foreground",
          "prose-blockquote:border-l-border prose-blockquote:text-muted-foreground",
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:rounded-md prose-pre:border prose-pre:border-border/60 prose-pre:bg-[color:var(--muted)]",
          "[&>p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&>p.is-editor-empty:first-child::before]:text-muted-foreground",
          "[&>p.is-editor-empty:first-child::before]:float-left",
          "[&>p.is-editor-empty:first-child::before]:h-0",
          "[&>p.is-editor-empty:first-child::before]:pointer-events-none",
        ].join(" "),
      },
    },
    onUpdate: ({ editor }) => {
      setReplyError("");
      setReplyText(editor.getText());

      const body = editor.getText();
      const bodyRich = editor.getJSON() as unknown as TiptapDoc;
      enqueueReplyDraftSave({
        title: replyTitleRef.current,
        body,
        bodyRich: bodyRich ?? null,
      });
    },
  });

  useEffect(() => {
    replyEditor?.setEditable(canCreateArgument);
  }, [replyEditor, canCreateArgument]);

  const handleReplyTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = event.target.value;
    replyTitleRef.current = nextTitle;
    setReplyTitle(nextTitle);

    const body = replyEditor?.getText() ?? replyText;
    const bodyRich = replyEditor ? (replyEditor.getJSON() as unknown as TiptapDoc) : null;
    enqueueReplyDraftSave({
      title: nextTitle,
      body,
      bodyRich: bodyRich ?? null,
    });
  };

  useEffect(() => {
    if (!isReplyDraftHydrated) return;
    if (!replyEditor) return;
    if (!replyDraftParentId) return;

    commitPendingReplyDraft({ silent: true });
    setReplyError("");

    let draft = null;
    try {
      draft = draftStore.getReplyDraft(topicId, replyDraftParentId);
    } catch {
      draft = null;
    }

    const nextDoc = (() => {
      if (!draft) return null;
      const parsed = draft.bodyRich ? zTiptapDoc.safeParse(draft.bodyRich) : null;
      if (parsed?.success) return parsed.data;
      return draft.body.trim() ? plainTextToTiptapDoc(draft.body) : null;
    })();

    skipReplyAutosaveRef.current = true;

    if (nextDoc) {
      replyEditor.commands.setContent(nextDoc as any, true);
      setReplyAutosave({ kind: "saved", savedAt: draft?.updatedAt ?? new Date().toISOString() });
      setReplyTitle(draft?.title ?? "");
    } else {
      replyEditor.commands.clearContent(true);
      setReplyAutosave({ kind: "idle" });
      setReplyTitle(draft?.title ?? "");
    }

    window.setTimeout(() => {
      skipReplyAutosaveRef.current = false;
    }, 0);
  }, [
    commitPendingReplyDraft,
    draftStore,
    isReplyDraftHydrated,
    replyDraftParentId,
    replyEditor,
    topicId,
  ]);

  useEffect(() => {
    return () => {
      commitPendingReplyDraft({ silent: true });
    };
  }, [commitPendingReplyDraft]);

  const editEditor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: t("stage.editPlaceholder"),
      }),
      Typography,
      Underline,
      TipTapLink.configure({ openOnClick: false }),
    ],
    content: "",
    editorProps: {
      attributes: {
        "aria-label": t("stage.editArgumentAria"),
        class: [
          "w-full min-h-[220px] p-4 text-foreground outline-none",
          "prose prose-base max-w-none",
          "prose-headings:font-serif prose-headings:tracking-tight",
          "prose-a:text-accent prose-a:underline prose-a:decoration-border/70 hover:prose-a:text-foreground",
          "prose-blockquote:border-l-border prose-blockquote:text-muted-foreground",
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:rounded-md prose-pre:border prose-pre:border-border/60 prose-pre:bg-[color:var(--muted)]",
          "[&>p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&>p.is-editor-empty:first-child::before]:text-muted-foreground",
          "[&>p.is-editor-empty:first-child::before]:float-left",
          "[&>p.is-editor-empty:first-child::before]:h-0",
          "[&>p.is-editor-empty:first-child::before]:pointer-events-none",
        ].join(" "),
      },
    },
    onUpdate: ({ editor }) => {
      if (!isSeedingEditRef.current) {
        isEditDirtyRef.current = true;
        setIsEditDirty(true);
      }
      setEditError("");
      setEditText(editor.getText());
    },
  });

  useEffect(() => {
    editEditor?.setEditable(canEditSelectedArgument && isEditingSelectedArgument);
  }, [editEditor, canEditSelectedArgument, isEditingSelectedArgument]);

  useEffect(() => {
    if (!isEditingSelectedArgument) return;
    if (!editEditor) return;
    if (!readArgument) return;

    const doc = readArgument.bodyRich ?? plainTextToTiptapDoc(readArgument.body);
    isSeedingEditRef.current = true;
    editEditor.commands.setContent(doc as any, false);
    setEditText(editEditor.getText());
    setEditTitle(readArgument.title ?? "");
    setEditError("");
    isSeedingEditRef.current = false;

    if (shouldFocusEditRef.current) {
      shouldFocusEditRef.current = false;
      const timer = window.setTimeout(() => {
        editEditor.chain().focus("end").run();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [editEditor, isEditingSelectedArgument, readArgument?.id]);

  useEffect(() => {
    if (!isEditingSelectedArgument) return;
    if (!editEditor) return;
    if (!selectedArgumentDetail) return;
    if (!readArgumentId) return;
    if (selectedArgumentDetail.id !== readArgumentId) return;
    if (isLoadingSelectedArgumentDetail) return;
    if (selectedArgumentDetailError) return;
    if (isEditDirtyRef.current) return;

    const doc = selectedArgumentDetail.bodyRich ?? plainTextToTiptapDoc(selectedArgumentDetail.body);
    isSeedingEditRef.current = true;
    editEditor.commands.setContent(doc as any, false);
    setEditText(editEditor.getText());
    setEditTitle(selectedArgumentDetail.title ?? "");
    setEditError("");
    isSeedingEditRef.current = false;
  }, [
    editEditor,
    isEditingSelectedArgument,
    selectedArgumentDetail,
    selectedArgumentDetailError,
    readArgumentId,
    isLoadingSelectedArgumentDetail,
  ]);

  async function submitReply() {
    if (!replyEditor) return;
    if (!canCreateArgument) return;
    if (tree.status !== "success") return;

    const parentId = selectedArgumentId ?? tree.topic.rootArgumentId;
    if (!parentId) return;

    const body = replyText.trim();
    if (!body) {
      setReplyError(t("createTopic.bodyRequired"));
      return;
    }

    setReplyError("");
    setIsSubmittingReply(true);

    const bodyRichResult = zTiptapDoc.safeParse(replyEditor.getJSON());
    const bodyRich = bodyRichResult.success ? bodyRichResult.data : null;

    const result = await apiClient.createArgument(topicId, {
      parentId,
      title: replyTitle.trim() ? replyTitle.trim() : null,
      body,
      bodyRich,
      initialVotes: 0,
    });

    setIsSubmittingReply(false);

    if (!result.ok) {
      setReplyError(toFriendlyMessage(t, result.error));
      return;
    }

    setLedger(result.data.ledger);
    invalidate();
    try {
      draftStore.removeReplyDraft(topicId, parentId);
      draftStore.setReplyMeta(topicId, { lastParentId: selectedArgumentId });
    } catch {
      // ignore
    }
    setReplyAutosave({ kind: "idle" });
    skipReplyAutosaveRef.current = true;
    setReplyTitle("");
    replyEditor.commands.clearContent(true);
    window.setTimeout(() => {
      skipReplyAutosaveRef.current = false;
    }, 0);
    setReplyText("");
    toast({ variant: "success", title: t("stage.submit"), message: t("stage.postSuccess") });
  }

  async function submitEdit() {
    if (!editEditor) return;
    if (!isEditingSelectedArgument) return;
    if (!canEditSelectedArgument) return;
    if (!readArgument) return;
    if (isSavingEdit) return;

    const body = editEditor.getText().trim();
    if (!body) {
      setEditError(t("createTopic.bodyRequired"));
      return;
    }

    setEditError("");
    setIsSavingEdit(true);

    const bodyRichResult = zTiptapDoc.safeParse(editEditor.getJSON());
    const bodyRich = bodyRichResult.success ? bodyRichResult.data : null;

    const argumentId = readArgument.id;

    const result = await apiClient.editArgument(topicId, argumentId, {
      title: editTitle.trim() ? editTitle.trim() : null,
      body,
      bodyRich,
    });

    setIsSavingEdit(false);

    if (!result.ok) {
      setEditError(toFriendlyMessage(t, result.error));
      return;
    }

    setSelectedArgumentDetail(result.data.argument);
    invalidate();
    isEditDirtyRef.current = false;
    setIsEditDirty(false);
    shouldFocusEditRef.current = false;
    setIsEditingSelectedArgument(false);
    toast({ variant: "success", title: t("stage.edit"), message: t("stage.updated") });
  }

  submitEditRef.current = () => {
    void submitEdit();
  };

  useEffect(() => {
    if (!isEditingSelectedArgument) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditingSelectedArgument();
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitEditRef.current?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cancelEditingSelectedArgument, isEditingSelectedArgument]);

  const insertQuote = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const targetEditor = isEditingSelectedArgument ? editEditor : replyEditor;
      if (!targetEditor) return;

      if (!targetEditor.isEditable) {
        toast({ variant: "warn", title: t("editor.quote"), message: t("stage.notEditable") });
        return;
      }

      const quoteDoc = plainTextToTiptapDoc(trimmed);
      const quoteContent = quoteDoc.content ?? [];

      targetEditor
        .chain()
        .focus("end")
        .insertContent(
          [
            { type: "blockquote", content: quoteContent },
            { type: "paragraph", content: [] },
          ] as any,
          { updateSelection: true } as any,
        )
        .run();
    },
    [editEditor, isEditingSelectedArgument, replyEditor, toast],
  );

  const handleInsertQuote = useCallback(() => {
    if (!quoteHint) return;
    insertQuote(quoteHint.text);
    setQuoteHint(null);
    try {
      document.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
  }, [insertQuote, quoteHint]);

  if (tree.status === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (tree.status === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Alert role="alert" variant="error" title={t("common.error")}>
          {tree.errorMessage}
        </Alert>
      </div>
    );
  }

  const topic = tree.topic;
  const topicTitle = topic.title.trim() ? topic.title : t("topics.untitled");
  const argumentCount = Math.max(0, tree.arguments.length - 1);
  const currentVotes = readArgument ? stakesByArgumentId[readArgument.id] ?? 0 : 0;

  const claimInfo =
    hasIdentity === true && topic.ownerPubkey === null
      ? (() => {
          try {
            return claimTokenStore.get(topicId);
          } catch {
            return null;
          }
        })()
      : null;

  async function claimOwner() {
    if (hasIdentity !== true) return;
    if (topic.ownerPubkey !== null) return;
    if (!claimInfo) return;

    setClaimError("");
    setIsClaiming(true);
    const result = await apiClient.executeTopicCommand(
      topicId,
      { type: "CLAIM_OWNER", payload: {} },
      { "x-claim-token": claimInfo.claimToken },
    );
    setIsClaiming(false);

    if (!result.ok) {
      setClaimError(result.error.message);
      toast({ variant: "error", title: t("topic.claimHost"), message: result.error.message });
      if (
        result.error.kind === "http" &&
        (result.error.code === "CLAIM_TOKEN_EXPIRED" || result.error.code === "CLAIM_TOKEN_INVALID")
      ) {
        try {
          claimTokenStore.remove(topicId);
        } catch {
          // ignore
        }
      }
      return;
    }

    try {
      claimTokenStore.remove(topicId);
    } catch {
      // ignore
    }
    toast({ variant: "success", title: t("topics.host"), message: t("topic.hostClaimedForTopic") });
    invalidate();
  }

  return (
    <>
	      {quoteHint ? (
	        <Button
	          size="sm"
	          variant="ghost"
	          className="fixed z-50 h-8 px-3 border border-border bg-background shadow-lg"
	          data-testid="selection-quote-button"
	          style={{ left: quoteHint.x, top: quoteHint.y, transform: "translate(-100%, -120%)" }}
	          onPointerDown={(event) => event.preventDefault()}
	          onClick={handleInsertQuote}
	        >
          {t("editor.quote")}
        </Button>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
        {reloadRequired ? (
          <Alert title={t("topic.reloadRequiredTitle")} variant="warn" role="alert">
            <div className="flex items-center justify-between gap-3">
              <span>{t("topic.reloadRequiredMessage")}</span>
              <Button onClick={() => window.location.reload()} size="sm">
                {t("common.refresh")}
              </Button>
            </div>
          </Alert>
        ) : null}

	        <div
	          ref={stageRef}
	          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm md:flex-row"
	          data-testid="topic-stage"
	          onMouseLeave={() => setIsLeftPaneHoverExpanded(false)}
	          style={{
	            ["--topic-left-width" as any]: `${leftPaneDisplayWidth}px`,
	            ["--topic-related-width" as any]: `${relatedPaneWidth}px`,
	          }}
	        >
	          {/* Left: Explorer */}
			          <div
			            ref={leftColumnRef}
			            className={[
			              "relative flex w-full flex-col overflow-hidden border-b border-border/60 bg-background md:border-b-0",
			              "md:transition-[width] md:duration-200 md:ease-out",
			              "md:w-[var(--topic-left-width)] md:min-w-[var(--topic-left-width)] md:border-r",
			            ].join(" ")}
			            data-testid="topic-stage-left"
			            onMouseEnter={() => {
			              if (resizeSessionRef.current) return;
			              setIsLeftPaneHoverExpanded(true);
			            }}
			          >
            <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate font-serif text-xl text-foreground" title={topicTitle}>
                  {topicTitle}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("stage.nodesCount", { count: argumentCount })}
                </p>
              </div>
              <Badge
                variant={topic.status === "active" ? "electric" : topic.status === "frozen" ? "acid" : "ink"}
              >
                {t(`status.${topic.status}`)}
              </Badge>
            </div>

            <div
              className="flex flex-1 items-center justify-center overflow-hidden p-4"
              onClick={() => {
                hideHoverCard({ immediate: true });
                requestSelectArgumentId(null);
              }}
            >
              {sunburstTree ? (
                <div className="relative" style={{ width: sunburstSize, height: sunburstSize }}>
                  <Sunburst
                    tree={sunburstTree}
                    width={sunburstSize}
                    height={sunburstSize}
                    padAngle={0.006}
                    interactive
                    showTooltip={false}
                    selectedId={selectedArgumentId}
                    onSelectedIdChange={(id) => {
                      hideHoverCard({ immediate: true });
                      requestSelectArgumentId(id);
                    }}
                    onHoverChange={handleSunburstHoverChange}
                  />

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="max-w-[160px] text-center font-serif text-xs font-semibold text-foreground/90">
                      {topicTitle.length > 12 ? `${topicTitle.slice(0, 10)}…` : topicTitle}
                    </span>
                  </div>

                  {hoverCard ? (
                    <div
                      className="pointer-events-none absolute z-10"
                      style={cardPosition(hoverCard.x, hoverCard.y)}
                      data-testid="sunburst-hover-card"
                    >
                      <div className="flex h-full flex-col rounded-lg border border-border/60 bg-background p-4 shadow-lg">
                        <div className="mb-2">
                          <h3 className="h-[44px] font-serif text-base font-semibold text-foreground leading-tight line-clamp-2">
                            {toTitle(hoverCard.argument)}
                          </h3>
                        </div>

                        <p className="flex-1 text-xs text-muted-foreground leading-relaxed line-clamp-4">
                          {toExcerpt(hoverCard.argument.body)}
                        </p>

                        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                          <span>{authorLabel(hoverCard.argument.authorId, hoverCard.argument.authorDisplayName)}</span>
                          <span>{t("stage.votesCount", { count: hoverCard.argument.totalVotes })}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("sunburstView.unavailable")}</p>
              )}
            </div>

            <div className="border-t border-border/60 px-4 py-4">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center border border-border bg-background"
                onClick={() => router.push(`/topics/${topicId}/report`)}
              >
                {t("stage.openReport")}
              </Button>

              {claimError ? (
                <div className="mt-3">
                  <Alert role="alert" variant="error" title={t("topic.claimHost")}>
                    {claimError}
                  </Alert>
                </div>
              ) : null}

              {claimInfo ? (
                <div className="mt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center border border-border"
                    onClick={claimOwner}
                    disabled={isClaiming}
                  >
                    {isClaiming ? t("topic.claiming") : t("topic.claimHost")}
                  </Button>
                </div>
              ) : null}

              {isOwner ? (
                <div className="mt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center border border-border bg-background"
                    onClick={() => setIsManageOpen(true)}
                  >
                    {t("topic.manage")}
                  </Button>
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <Link href="/" className="hover:text-foreground">
                  {t("brand.hostedBy")}
                </Link>
                {identityFingerprint ? (
                  <Link
                    href="/my"
                    className="flex items-center gap-2 hover:text-foreground"
                    title={t("identity.myIdentity")}
                  >
                    {myAuthorId ? (
                      <span className="font-medium text-foreground/90">{authorLabel(myAuthorId)}</span>
                    ) : (
                      <span className="font-medium text-foreground/90">{t("my.identityReady")}</span>
                    )}
                  </Link>
                ) : null}
	              </div>
	            </div>
	          </div>

	          <div
	            role="separator"
	            aria-orientation="vertical"
	            aria-label="Resize panels"
	            className={[
	              "relative hidden w-3 shrink-0 cursor-col-resize touch-none md:block",
	              "hover:bg-[color:var(--muted)]",
	            ].join(" ")}
	            onPointerDown={startResizingLeft}
	            onDoubleClick={() => {
	              setIsLeftPaneHoverExpanded(false);
	              setLeftPaneWidth(clampLeftPaneWidth(DEFAULT_LEFT_PANE_WIDTH));
	            }}
	          >
	            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/60" />
	          </div>

          {/* Right: Reader */}
		          <div
		            ref={rightColumnRef}
		            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
		            data-testid="topic-stage-right"
		            onMouseEnter={() => {
		              if (resizeSessionRef.current) return;
		              setIsLeftPaneHoverExpanded(false);
		            }}
		          >
	            <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
	              {readArgument ? (
	                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
	                  <div className="border-b border-border/60 px-6 py-6">
	                  {isEditingSelectedArgument ? (
	                    <Input
	                      aria-label={t("stage.editTitleAria")}
                      value={editTitle}
                      onChange={(e) => {
                        isEditDirtyRef.current = true;
                        setIsEditDirty(true);
                        setEditTitle(e.target.value);
                      }}
                      placeholder={t("stage.titleOptionalPlaceholder")}
                      className="border-0 rounded-none bg-transparent px-0 py-0 font-serif text-2xl leading-tight shadow-none"
                      maxLength={160}
                      disabled={isSavingEdit}
                    />
                  ) : (
                    <h1 className="font-serif text-2xl leading-tight text-foreground">
                      {toTitle(readArgument)}
                    </h1>
                  )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span>{authorLabel(readArgument.authorId, readArgument.authorDisplayName)}</span>
                      <span aria-hidden className="text-border">
                        ·
                      </span>
                      <span>{new Date(readArgument.createdAt).toLocaleDateString()}</span>
                      <span aria-hidden className="text-border">
                        ·
                      </span>
                      <span>{t("stage.votesCount", { count: readArgument.totalVotes })}</span>
                    </div>

                    {isEditingSelectedArgument ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3 border border-border bg-background"
                          onClick={cancelEditingSelectedArgument}
                          disabled={isSavingEdit}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          variant="ink"
                          size="sm"
                          onClick={submitEdit}
                          disabled={!canEditSelectedArgument || isSavingEdit || !editText.trim()}
                        >
                          {isSavingEdit ? t("common.saving") : t("stage.saveChanges")}
                        </Button>
                      </div>
                    ) : canEditSelectedArgument ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3 border border-border bg-background"
                        onClick={startEditingSelectedArgument}
                        title={
                          selectedArgumentDetailError
                            ? t("common.loadFailed")
                            : isLoadingSelectedArgumentDetail
                              ? t("common.loading")
                              : t("stage.edit")
                        }
                      >
                        {t("stage.edit")}
                      </Button>
                    ) : null}
                  </div>
                  {isEditingSelectedArgument ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{t("stage.editAiHint")}</span>
                      <span className="font-mono">{t("stage.editHotkeysHint")}</span>
                    </div>
                  ) : null}
                </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
		                  <div className="mx-auto w-full max-w-[760px]">
                      {isEditingSelectedArgument ? (
                        <div>
                          <div
                            aria-label={t("stage.inlineEditorAria")}
                            className="overflow-hidden rounded-lg border border-border/60 bg-background"
                          >
                            {isEditEditorMode ? (
                              <div className="sticky top-0 z-10">
                                <RichTextToolbar
                                  editor={editEditor}
                                  onRequestHideToolbar={() => setIsEditEditorMode(false)}
                                />
                              </div>
                            ) : (
                              <div className="sticky top-0 z-10 border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-3 border border-border bg-background"
                                  onClick={() => setIsEditEditorMode(true)}
                                >
                                  {t("stage.showToolbar")}
                                </Button>
                              </div>
                            )}
                            <EditorContent editor={editEditor} />
                          </div>

                          {editError ? (
                            <p role="alert" className="mt-2 text-xs text-destructive">
                              {editError}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div
                          ref={readerContentRef}
                          className={[
                            "prose prose-lg max-w-none",
                            "prose-headings:font-serif prose-headings:tracking-tight",
                            "prose-a:text-accent prose-a:underline prose-a:decoration-border/70 hover:prose-a:text-foreground",
                            "prose-blockquote:border-l-border prose-blockquote:text-muted-foreground",
                            "prose-code:before:content-none prose-code:after:content-none",
                            "prose-pre:rounded-md prose-pre:border prose-pre:border-border/60 prose-pre:bg-[color:var(--muted)]",
                          ].join(" ")}
                        >
                          {readArgument.bodyRich ? (
                            <TiptapRenderer
                              doc={readArgument.bodyRich}
                              fallback={readArgument.body}
                            />
                          ) : (
                            <p className="whitespace-pre-wrap">{readArgument.body}</p>
                          )}
                        </div>
                      )}
                  </div>

                  {ledgerError ? (
                    <div className="mt-6">
                      <Alert role="alert" variant="error" title={t("topic.ledger")}>
                        {ledgerError}
                      </Alert>
                    </div>
                  ) : null}
                </div>

                {hasIdentity ? (
                  <VoteStepper
                    topicId={topicId}
                    argument={readArgument}
                    topicStatus={topic.status}
                    ledger={ledger}
                    currentVotes={currentVotes}
                    onLedgerUpdated={setLedger}
                    onVotesUpdated={(votes) => {
                      setStakesByArgumentId((prev) => ({ ...prev, [readArgument.id]: votes }));
                    }}
                    onInvalidate={invalidate}
                  />
                ) : null}

	                <div className="border-t border-border/60 px-6 py-4">
	                  <div className="mx-auto w-full max-w-[760px]">
	                    <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
	                      <div className="border-b border-border/60 bg-background">
		                        <Input
		                          value={replyTitle}
		                          onChange={handleReplyTitleChange}
		                          placeholder={t("stage.titleOptionalPlaceholder")}
		                          className="h-11 border-0 rounded-none shadow-none font-serif text-base"
		                          maxLength={160}
		                          disabled={!canCreateArgument || isSubmittingReply}
		                        />
	                      </div>
	                      {isReplyEditorMode ? (
	                        <RichTextToolbar
	                          editor={replyEditor}
	                          onRequestHideToolbar={() => setIsReplyEditorMode(false)}
	                        />
	                      ) : (
	                        <div className="border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
		                          <Button
		                            size="sm"
		                            variant="ghost"
		                            className="h-8 px-3 border border-border bg-background"
		                            onClick={() => setIsReplyEditorMode(true)}
		                          >
		                            {t("stage.showToolbar")}
		                          </Button>
		                        </div>
		                      )}

	                      <EditorContent editor={replyEditor} />
	                    </div>

                    {replyError ? (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        {replyError}
                      </p>
                    ) : null}

	                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
	                      {replyAutosave.kind !== "idle" ? (
	                        <span
	                          className={[
	                            "text-xs",
                            replyAutosave.kind === "error" ? "text-destructive" : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {replyAutosave.kind === "saving"
                            ? t("dialogue.autosaveSaving")
                            : replyAutosave.kind === "saved"
                              ? t("dialogue.autosaveSavedAt", {
                                  time: formatSavedTime(replyAutosave.savedAt) ?? "",
                                }).trim()
                              : replyAutosave.message}
                        </span>
                      ) : (
	                        <span />
	                      )}

	                      <div className="flex flex-col items-end gap-1">
	                        <div className="flex items-center gap-2">
		                            <Input
		                              value={topicDisplayName}
		                              onChange={handleTopicDisplayNameChange}
		                              placeholder={t("stage.topicNamePlaceholder")}
		                              aria-label={t("stage.topicNamePlaceholder")}
		                              data-testid="topic-display-name-input"
		                              className="h-8 w-[180px] py-0 text-xs"
		                              maxLength={40}
		                              disabled={!hasIdentity}
		                            />
	                            <Button
	                              variant="ink"
	                              size="sm"
	                              onClick={submitReply}
	                              disabled={!canCreateArgument || isSubmittingReply || !replyText.trim()}
	                            >
	                              {isSubmittingReply ? t("stage.submitting") : t("stage.submit")}
	                            </Button>
	                          </div>
                          {topicDisplayNameSave.kind !== "idle" ? (
                            <span
                              className={[
                                "text-[10px]",
                                topicDisplayNameSave.kind === "error" ? "text-destructive" : "text-muted-foreground",
                              ].join(" ")}
                            >
                              {topicDisplayNameSave.kind === "saving"
                                ? t("stage.nameSaving")
                                : topicDisplayNameSave.kind === "saved"
                                  ? t("stage.nameSaved")
                                  : topicDisplayNameSave.message}
                            </span>
                          ) : null}
                        </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-10 text-center">
                <h2 className="font-serif text-2xl text-foreground">{t("stage.emptyTitle")}</h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {t("stage.emptyBody")}
                </p>

	                <div className="mt-8 w-full max-w-[760px]">
	                  <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
	                    <div className="border-b border-border/60 bg-background">
		                      <Input
		                        value={replyTitle}
		                        onChange={handleReplyTitleChange}
		                        placeholder={t("stage.titleOptionalPlaceholder")}
		                        className="h-11 border-0 rounded-none shadow-none font-serif text-base"
		                        maxLength={160}
		                        disabled={!canCreateArgument || isSubmittingReply}
		                      />
	                    </div>
	                    {isReplyEditorMode ? (
	                      <RichTextToolbar
	                        editor={replyEditor}
	                        onRequestHideToolbar={() => setIsReplyEditorMode(false)}
	                      />
	                    ) : (
	                      <div className="border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
		                          <Button
		                            size="sm"
		                            variant="ghost"
		                            className="h-8 px-3 border border-border bg-background"
		                            onClick={() => setIsReplyEditorMode(true)}
		                          >
		                            {t("stage.showToolbar")}
		                          </Button>
		                      </div>
		                    )}

	                    <EditorContent editor={replyEditor} />
	                  </div>

                  {replyError ? (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      {replyError}
                    </p>
                  ) : null}

	                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
	                    {replyAutosave.kind !== "idle" ? (
	                      <span
	                        className={[
	                          "text-xs",
                          replyAutosave.kind === "error" ? "text-destructive" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {replyAutosave.kind === "saving"
                          ? t("dialogue.autosaveSaving")
                          : replyAutosave.kind === "saved"
                            ? t("dialogue.autosaveSavedAt", {
                                time: formatSavedTime(replyAutosave.savedAt) ?? "",
                              }).trim()
                            : replyAutosave.message}
                      </span>
                    ) : (
                      <span />
                    )}

                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
		                        <Input
		                          value={topicDisplayName}
		                          onChange={handleTopicDisplayNameChange}
		                          placeholder={t("stage.topicNamePlaceholder")}
		                          aria-label={t("stage.topicNamePlaceholder")}
		                          data-testid="topic-display-name-input"
		                          className="h-8 w-[180px] py-0 text-xs"
		                          maxLength={40}
		                          disabled={!hasIdentity}
		                        />
	                        <Button
	                          variant="ink"
	                          size="sm"
	                          onClick={submitReply}
	                          disabled={
	                            !canCreateArgument ||
	                            isSubmittingReply ||
	                            !replyText.trim() ||
	                            !rootArgumentId
	                          }
	                        >
	                          {isSubmittingReply ? t("stage.submitting") : t("stage.submitArgument")}
	                        </Button>
	                      </div>
                      {topicDisplayNameSave.kind !== "idle" ? (
                        <span
                          className={[
                            "text-[10px]",
                            topicDisplayNameSave.kind === "error" ? "text-destructive" : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {topicDisplayNameSave.kind === "saving"
                            ? t("stage.nameSaving")
                            : topicDisplayNameSave.kind === "saved"
                              ? t("stage.nameSaved")
                              : topicDisplayNameSave.message}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {topic.status !== "active" ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("stage.topicReadonlyCannotPost", {
                        status: t(`status.${topic.status}`),
                      })}
		                    </p>
		                  ) : null}

                  <div className="mt-6 rounded-lg border border-border/60 bg-background lg:hidden">
                    <div className="border-b border-border/60 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate font-serif text-sm font-semibold text-foreground">
                            {t("stage.relatedTitle")}
                          </h2>
                          <p className="mt-1 text-xs text-muted-foreground">{t("stage.relatedHint")}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-3 border border-border bg-background"
                          onClick={() => setIsMobileRelatedOpen((prev) => !prev)}
                        >
                          {isMobileRelatedOpen ? t("common.hide") : t("common.show")}
                        </Button>
                      </div>
                    </div>

                    {isMobileRelatedOpen ? (
                      <div className="max-h-[40vh] overflow-y-auto px-4 py-4">
                        {related ? (
                          <div className="space-y-6">
                            <div>
                              <h3 className="text-xs font-medium text-muted-foreground">{t("stage.relatedSimilar")}</h3>
                              <div className="mt-2 space-y-2">
                                {readArgument?.analysisStatus !== "ready" ? (
                                  <p className="text-xs text-muted-foreground">{t("stage.relatedSimilarPending")}</p>
                                ) : relatedSimilarStatus === "loading" ? (
                                  <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
                                ) : relatedSimilarStatus === "error" ? (
                                  <p role="alert" className="text-xs text-destructive">
                                    {relatedSimilarError}
                                  </p>
                                ) : relatedSimilar.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">{t("stage.relatedSimilarEmpty")}</p>
                                ) : (
                                      relatedSimilar.map(({ arg, similarity }) => {
                                        const isRoot = rootArgumentId !== null && arg.id === rootArgumentId;
                                        const title = isRoot ? topicTitle : toTitle(arg);
                                        const excerpt = toExcerpt(arg.body);
                                        const weight = similarity.toFixed(2);

                                        return (
                                          <button
                                            key={arg.id}
                                            type="button"
                                        className={[
                                          "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                          "hover:bg-[color:var(--muted)] transition-colors",
                                        ].join(" ")}
                                        onClick={() => requestSelectArgumentId(isRoot ? null : arg.id)}
                                          >
                                            <div className="flex items-start gap-2">
                                              <span className="text-xs text-muted-foreground">›</span>
                                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                                                {weight}
                                              </span>
                                              <span className="text-[10px] text-muted-foreground">|</span>
                                              <span className="min-w-0 flex-1 font-serif text-sm leading-snug text-foreground line-clamp-2">
                                                {title}
                                              </span>
                                              <span className="shrink-0 text-xs text-muted-foreground">›</span>
                                            </div>
                                            {excerpt ? (
                                              <p className="mt-1 line-clamp-4 text-xs text-muted-foreground leading-relaxed">
                                                {excerpt}
                                              </p>
                                            ) : null}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                            {related.ancestors.length > 0 ? (
                              <div>
                                <h3 className="text-xs font-medium text-muted-foreground">{t("stage.relatedPath")}</h3>
                                <div className="mt-2 space-y-2">
                                  {related.ancestors.map((arg) => {
                                    const isRoot = rootArgumentId !== null && arg.id === rootArgumentId;
                                    const title = isRoot ? topicTitle : toTitle(arg);
                                    const excerpt = toExcerpt(arg.body);

                                    return (
                                      <button
                                        key={arg.id}
                                        type="button"
                                        className={[
                                          "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                          "hover:bg-[color:var(--muted)] transition-colors",
                                        ].join(" ")}
                                        onClick={() => requestSelectArgumentId(isRoot ? null : arg.id)}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <span className="font-serif text-sm leading-snug text-foreground">{title}</span>
                                          <span className="shrink-0 text-[10px] text-muted-foreground">
                                            {t("stage.votesCount", { count: arg.totalVotes })}
                                          </span>
                                        </div>
                                        {excerpt ? (
                                          <p className="mt-1 line-clamp-4 text-xs text-muted-foreground leading-relaxed">
                                            {excerpt}
                                          </p>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}

                            {related.children.length > 0 ? (
                              <div>
                                <h3 className="text-xs font-medium text-muted-foreground">{t("stage.relatedChildren")}</h3>
                                <div className="mt-2 space-y-2">
                                  {related.children.map((arg) => {
                                    const title = toTitle(arg);
                                    const excerpt = toExcerpt(arg.body);

                                    return (
                                      <button
                                        key={arg.id}
                                        type="button"
                                        className={[
                                          "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                          "hover:bg-[color:var(--muted)] transition-colors",
                                        ].join(" ")}
                                        onClick={() => requestSelectArgumentId(arg.id)}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <span className="font-serif text-sm leading-snug text-foreground">{title}</span>
                                          <span className="shrink-0 text-[10px] text-muted-foreground">
                                            {t("stage.votesCount", { count: arg.totalVotes })}
                                          </span>
                                        </div>
                                        {excerpt ? (
                                          <p className="mt-1 line-clamp-4 text-xs text-muted-foreground leading-relaxed">
                                            {excerpt}
                                          </p>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}

                            {related.siblings.length > 0 ? (
                              <div>
                                <h3 className="text-xs font-medium text-muted-foreground">{t("stage.relatedSiblings")}</h3>
                                <div className="mt-2 space-y-2">
                                  {related.siblings.map((arg) => {
                                    const title = toTitle(arg);
                                    const excerpt = toExcerpt(arg.body);

                                    return (
                                      <button
                                        key={arg.id}
                                        type="button"
                                        className={[
                                          "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                          "hover:bg-[color:var(--muted)] transition-colors",
                                        ].join(" ")}
                                        onClick={() => requestSelectArgumentId(arg.id)}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <span className="font-serif text-sm leading-snug text-foreground">{title}</span>
                                          <span className="shrink-0 text-[10px] text-muted-foreground">
                                            {t("stage.votesCount", { count: arg.totalVotes })}
                                          </span>
                                        </div>
                                        {excerpt ? (
                                          <p className="mt-1 line-clamp-4 text-xs text-muted-foreground leading-relaxed">
                                            {excerpt}
                                          </p>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                        )}
                      </div>
                    ) : null}
                  </div>
		                </div>
		              </div>
		            )}

	                <div
	                  role="separator"
	                  aria-orientation="vertical"
	                  aria-label="Resize panels"
	                  className={[
	                    "relative hidden w-3 shrink-0 cursor-col-resize touch-none lg:block",
	                    "hover:bg-[color:var(--muted)]",
	                  ].join(" ")}
	                  onPointerDown={startResizingRelated}
	                  onDoubleClick={() => setRelatedPaneWidth(clampRelatedPaneWidth(DEFAULT_RELATED_PANE_WIDTH))}
	                >
                  <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/60" />
                </div>

                <aside
                  className="hidden min-h-0 w-[var(--topic-related-width)] shrink-0 flex-col border-l border-border/60 bg-background lg:flex"
                  onPointerLeave={() => setRelatedHoverId(null)}
                >
                  <div className="border-b border-border/60 px-4 py-4">
                    <h2 className="font-serif text-sm font-semibold text-foreground">{t("stage.relatedTitle")}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{t("stage.relatedHint")}</p>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    {related ? (
                      <div className="space-y-6">
                        {(() => {
                          const previewArgument = relatedHoverArgument ?? readArgument;
                          if (!previewArgument) return null;

                          const isRoot = rootArgumentId !== null && previewArgument.id === rootArgumentId;
                          const title = isRoot ? topicTitle : toTitle(previewArgument);
                          const excerpt = previewArgument.body ? toExcerpt(previewArgument.body) : "";

                          return (
                            <div className="sticky top-0 z-10 bg-background pb-4">
                              <div className="rounded-lg border border-border/60 bg-background p-3 shadow-sm">
                                <div className="flex min-w-0 items-start justify-between gap-2">
                                  <h3 className="min-h-[40px] min-w-0 flex-1 font-serif text-sm font-semibold text-foreground leading-snug line-clamp-2">
                                    {title}
                                  </h3>
                                  <span className="shrink-0 text-[10px] text-muted-foreground">
                                    {t("stage.votesCount", { count: previewArgument.totalVotes })}
                                  </span>
                                </div>
                                <p className="mt-2 min-h-[80px] line-clamp-4 text-xs text-muted-foreground leading-relaxed">
                                  {excerpt}
                                </p>
                                <div className="mt-3 flex min-w-0 items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                                  <span className="min-w-0 truncate">
                                    {authorLabel(
                                      previewArgument.authorId,
                                      previewArgument.authorDisplayName,
                                    )}
                                  </span>
                                  <span className="shrink-0">{new Date(previewArgument.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        <div>
                          <h3 className="text-xs font-medium text-muted-foreground">{t("stage.relatedSimilar")}</h3>
                          <div className="mt-2 space-y-2">
                            {readArgument?.analysisStatus !== "ready" ? (
                              <p className="text-xs text-muted-foreground">{t("stage.relatedSimilarPending")}</p>
                            ) : relatedSimilarStatus === "loading" ? (
                              <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
                            ) : relatedSimilarStatus === "error" ? (
                              <p role="alert" className="text-xs text-destructive">
                                {relatedSimilarError}
                              </p>
                            ) : relatedSimilar.length === 0 ? (
                              <p className="text-xs text-muted-foreground">{t("stage.relatedSimilarEmpty")}</p>
                            ) : (
                              relatedSimilar.map(({ arg, similarity }) => {
                                const isRoot = rootArgumentId !== null && arg.id === rootArgumentId;
                                const title = isRoot ? topicTitle : toTitle(arg);
                                const weight = similarity.toFixed(2);

                                return (
                                  <button
                                    key={arg.id}
                                    type="button"
                                    className={[
                                      "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                      "hover:bg-[color:var(--muted)] transition-colors",
                                    ].join(" ")}
                                    onPointerEnter={() => setRelatedHoverId(arg.id)}
                                    onFocus={() => setRelatedHoverId(arg.id)}
                                    onClick={() => requestSelectArgumentId(isRoot ? null : arg.id)}
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs text-muted-foreground">›</span>
                                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                                        {weight}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">|</span>
                                      <span className="min-w-0 flex-1 font-serif text-sm leading-snug text-foreground line-clamp-2">
                                        {title}
                                      </span>
                                      <span className="shrink-0 text-xs text-muted-foreground">›</span>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                        {related.ancestors.length > 0 ? (
                          <div>
                            <h3 className="text-xs font-medium text-muted-foreground">{t("stage.relatedPath")}</h3>
                            <div className="mt-2 space-y-2">
                              {related.ancestors.map((arg) => {
                                const isRoot = rootArgumentId !== null && arg.id === rootArgumentId;
                                const title = isRoot ? topicTitle : toTitle(arg);

                                return (
                                  <button
                                    key={arg.id}
                                    type="button"
                                    className={[
                                      "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                      "hover:bg-[color:var(--muted)] transition-colors",
                                    ].join(" ")}
                                    onPointerEnter={() => setRelatedHoverId(arg.id)}
                                    onFocus={() => setRelatedHoverId(arg.id)}
                                    onClick={() => requestSelectArgumentId(isRoot ? null : arg.id)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-serif text-sm leading-snug text-foreground">{title}</span>
                                      <span className="shrink-0 text-[10px] text-muted-foreground">
                                        {t("stage.votesCount", { count: arg.totalVotes })}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {related.children.length > 0 ? (
                          <div>
                            <h3 className="text-xs font-medium text-muted-foreground">
                              {t("stage.relatedChildren")}
                            </h3>
                            <div className="mt-2 space-y-2">
                              {related.children.map((arg) => {
                                const title = toTitle(arg);

                                return (
                                  <button
                                    key={arg.id}
                                    type="button"
                                    className={[
                                      "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                      "hover:bg-[color:var(--muted)] transition-colors",
                                    ].join(" ")}
                                    onPointerEnter={() => setRelatedHoverId(arg.id)}
                                    onFocus={() => setRelatedHoverId(arg.id)}
                                    onClick={() => requestSelectArgumentId(arg.id)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-serif text-sm leading-snug text-foreground">{title}</span>
                                      <span className="shrink-0 text-[10px] text-muted-foreground">
                                        {t("stage.votesCount", { count: arg.totalVotes })}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {related.siblings.length > 0 ? (
                          <div>
                            <h3 className="text-xs font-medium text-muted-foreground">
                              {t("stage.relatedSiblings")}
                            </h3>
                            <div className="mt-2 space-y-2">
                              {related.siblings.map((arg) => {
                                const title = toTitle(arg);

                                return (
                                  <button
                                    key={arg.id}
                                    type="button"
                                    className={[
                                      "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left",
                                      "hover:bg-[color:var(--muted)] transition-colors",
                                    ].join(" ")}
                                    onPointerEnter={() => setRelatedHoverId(arg.id)}
                                    onFocus={() => setRelatedHoverId(arg.id)}
                                    onClick={() => requestSelectArgumentId(arg.id)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-serif text-sm leading-snug text-foreground">{title}</span>
                                      <span className="shrink-0 text-[10px] text-muted-foreground">
                                        {t("stage.votesCount", { count: arg.totalVotes })}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                    )}
	                  </div>
	                </aside>
	              </div>
	          </div>
	        </div>
	      </div>

      {isOwner && isManageOpen ? (
        <TopicManagePanel
          topicId={topicId}
          topicTitle={topic.title}
          topicStatus={topic.status}
          topicVisibility={topic.visibility}
          rootBody={topic.rootBody}
          defaultArgumentId={selectedArgumentId}
          onInvalidate={invalidate}
          onClose={() => setIsManageOpen(false)}
        />
      ) : null}

    </>
  );
}
