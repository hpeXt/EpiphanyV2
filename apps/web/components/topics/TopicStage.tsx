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

import { ConsensusReportModal } from "@/components/topics/ConsensusReportModal";
import { TopicManagePanel } from "@/components/topics/TopicManagePanel";
import { useTopicSse } from "@/components/topics/hooks/useTopicSse";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Button } from "@/components/ui/P5Button";
import { P5Input } from "@/components/ui/P5Input";
import { P5Modal } from "@/components/ui/P5Modal";
import { useP5Toast } from "@/components/ui/P5ToastProvider";
import { TiptapRenderer } from "@/components/ui/TiptapRenderer";
import { Sunburst } from "@/components/visualizations/Sunburst";
import { createLocalStorageClaimTokenStore } from "@/lib/claimTokenStore";
import { createLocalStorageDraftStore } from "@/lib/draftStore";
import { authorIdFromPubkeyHex, deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
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

function toTitle(arg: Argument): string {
  if (arg.title) return arg.title;
  const trimmed = arg.body.trim();
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return arg.id;
}

function toExcerpt(text: string, maxLen = 140): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
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

const ROOT_AUTHOR_ID = "66687aadf862bd77";

const AUTHOR_ADJECTIVES = [
  "Adept",
  "Amber",
  "Arcane",
  "Breezy",
  "Calm",
  "Candid",
  "Careful",
  "Cobalt",
  "Curious",
  "Daring",
  "Deep",
  "Discrete",
  "Earnest",
  "Elder",
  "Exact",
  "Faint",
  "Feral",
  "Fluent",
  "Gentle",
  "Glassy",
  "Golden",
  "Grand",
  "Hardy",
  "Humble",
  "Icy",
  "Keen",
  "Kind",
  "Liminal",
  "Lucid",
  "Mild",
  "Mirthful",
  "Modern",
  "Narrow",
  "Nimble",
  "Noisy",
  "Oblique",
  "Patient",
  "Plain",
  "Proud",
  "Quiet",
  "Rare",
  "Rational",
  "Ready",
  "Sincere",
  "Slow",
  "Solid",
  "Sparse",
  "Steady",
  "Swift",
  "Tender",
  "Terse",
  "True",
  "Vast",
  "Vivid",
  "Warm",
  "Wary",
  "Witty",
  "Young",
  "Zesty",
] as const;

const AUTHOR_NOUNS = [
  "Anchor",
  "Apricot",
  "Atlas",
  "Beacon",
  "Birch",
  "Bridge",
  "Cipher",
  "Comet",
  "Cortex",
  "Crane",
  "Delta",
  "Dune",
  "Echo",
  "Ember",
  "Fable",
  "Fjord",
  "Flint",
  "Folio",
  "Grove",
  "Harbor",
  "Horizon",
  "Juniper",
  "Kernel",
  "Lattice",
  "Ledger",
  "Loom",
  "Maple",
  "Meadow",
  "Meridian",
  "Mirror",
  "Nexus",
  "Oak",
  "Opal",
  "Orbit",
  "Parcel",
  "Pillar",
  "Pine",
  "Prism",
  "Quarry",
  "Quill",
  "Reed",
  "Relay",
  "Ridge",
  "River",
  "Rune",
  "Saffron",
  "Sail",
  "Shell",
  "Signal",
  "Slate",
  "Spark",
  "Stone",
  "Thread",
  "Thistle",
  "Vessel",
  "Violet",
  "Wave",
  "Willow",
  "Wren",
] as const;

function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function pseudonymFromAuthorId(authorId: string): string {
  if (authorId === ROOT_AUTHOR_ID) return "Topic";

  const bytes = hexToBytes(authorId);
  if (!bytes || bytes.length < 2) return authorId;

  const adjective = AUTHOR_ADJECTIVES[bytes[0] % AUTHOR_ADJECTIVES.length];
  const noun = AUTHOR_NOUNS[bytes[1] % AUTHOR_NOUNS.length];
  return `${adjective} ${noun}`;
}

function toFriendlyMessage(error: ApiError): string {
  if (error.kind === "http") {
    if (error.status === 402 || error.code === "INSUFFICIENT_BALANCE") {
      return "余额不足";
    }
    if (error.status === 401 && error.code === "INVALID_SIGNATURE") {
      return "签名验证失败，请刷新页面重试";
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

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 w-8 p-0 border border-border bg-background",
          editor.isActive("bold") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-label="Bold"
      >
        B
      </P5Button>
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 w-8 p-0 border border-border bg-background italic",
          editor.isActive("italic") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Italic"
      >
        I
      </P5Button>
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 w-8 p-0 border border-border bg-background underline",
          editor.isActive("underline") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        aria-label="Underline"
      >
        U
      </P5Button>

      <div className="mx-1 h-4 w-px bg-border/80" />

      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("heading", { level: 2 }) ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-label="Heading 2"
      >
        H2
      </P5Button>
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("heading", { level: 3 }) ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-label="Heading 3"
      >
        H3
      </P5Button>

      <div className="mx-1 h-4 w-px bg-border/80" />

      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("bulletList") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        aria-label="Bullet list"
      >
        •
      </P5Button>
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("orderedList") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        aria-label="Ordered list"
      >
        1.
      </P5Button>
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("blockquote") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        aria-label="Blockquote"
      >
        “
      </P5Button>
      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background font-mono",
          editor.isActive("codeBlock") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        aria-label="Code block"
      >
        {"</>"}
      </P5Button>

      <div className="mx-1 h-4 w-px bg-border/80" />

      <P5Button
        size="sm"
        variant="ghost"
        className={[
          "h-8 px-2 border border-border bg-background",
          editor.isActive("link") ? "bg-muted" : "",
        ].join(" ")}
        onClick={() => {
          const previousUrl = editor.getAttributes("link").href as string | undefined;
          const nextUrl = window.prompt("Link URL", previousUrl ?? "");
          if (nextUrl === null) return;
          const trimmed = nextUrl.trim();
          if (!trimmed) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
        }}
        aria-label="Link"
      >
        ↗
      </P5Button>
      </div>

      {onRequestHideToolbar ? (
        <P5Button
          size="sm"
          variant="ghost"
          className="h-8 px-3 border border-border bg-background"
          onClick={onRequestHideToolbar}
          aria-label="隐藏工具栏"
        >
          隐藏
        </P5Button>
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
  const { toast } = useP5Toast();

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
        title: "read-only",
        message: props.argument.prunedAt ? "节点已被隐藏：只能撤回投票。" : "议题只读：只能撤回投票。",
      });
      return;
    }

    if (availableBalance !== null) {
      const nextCost = next * next;
      const nextDeltaCost = nextCost - currentCost;
      if (nextDeltaCost > availableBalance) {
        toast({ variant: "error", title: "votes", message: "投票力不足" });
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
      setSubmitError(toFriendlyMessage(result.error));
      return;
    }

    props.onLedgerUpdated(result.data.ledger);
    props.onVotesUpdated(result.data.targetVotes);
    props.onInvalidate();
    toast({ variant: "success", title: "votes", message: "投票已记录" });
  };

  return (
    <div className="border-t border-border/60 bg-[color:var(--muted)] px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-muted-foreground">支持度:</span>
          <div className="flex items-center gap-2">
            <P5Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 border border-border bg-background"
              onClick={() => setByDelta(-1)}
              disabled={targetVotes === 0 || isSubmitting}
              aria-label="Decrease votes"
            >
              −
            </P5Button>
            <div className="w-10 text-center">
              <span className="text-lg font-medium text-foreground">{targetVotes}</span>
            </div>
            <P5Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 border border-border bg-background"
              onClick={() => setByDelta(1)}
              disabled={targetVotes === 10 || isSubmitting}
              aria-label="Increase votes"
            >
              +
            </P5Button>
          </div>

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>
              消耗: {targetCost} (Δ{formatDelta(deltaCost)})
            </span>
            {availableBalance !== null ? (
              <span>余额: {availableBalance}</span>
            ) : null}
          </div>
        </div>

        <P5Button
          size="sm"
          variant="ink"
          onClick={submit}
          disabled={disableSubmit || targetVotes === props.currentVotes}
        >
          {isSubmitting ? "保存中…" : "确认投票"}
        </P5Button>
      </div>

      {increaseForbidden ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {props.argument.prunedAt
            ? "该节点已被隐藏：只能撤回投票。"
            : "该议题为只读：只能撤回投票。"}
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
  const { toast } = useP5Toast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const visitedStore = useMemo(() => createLocalStorageVisitedTopicsStore(), []);
  const claimTokenStore = useMemo(() => createLocalStorageClaimTokenStore(), []);
  const draftStore = useMemo(() => createLocalStorageDraftStore(), []);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const lastPointerSideRef = useRef<"left" | "right" | null>(null);
  const readerContentRef = useRef<HTMLDivElement | null>(null);

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
  const [activeSide, setActiveSide] = useState<"left" | "right" | null>(null);
  const [hoverCard, setHoverCard] = useState<HoverCardState | null>(null);
  const [quoteHint, setQuoteHint] = useState<{ text: string; x: number; y: number } | null>(null);
  const selectedArgumentIdRef = useRef<string | null>(null);
  selectedArgumentIdRef.current = selectedArgumentId;

  // Keep URL arg=<argumentId> in sync with selection (and support deep-links).
  useEffect(() => {
    const next = argFromUrl || null;
    if (next === selectedArgumentIdRef.current) return;
    setSelectedArgumentId(next);
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

  const [ledger, setLedger] = useState<LedgerMe | null>(null);
  const [ledgerError, setLedgerError] = useState("");

  const [stakesByArgumentId, setStakesByArgumentId] = useState<Record<string, number>>({});
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditEditorMode, setIsEditEditorMode] = useState(true);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const authorLabel = useCallback(
    (authorId: string, authorDisplayName?: string | null) => {
      const custom = topicDisplayName.trim();
      if (myAuthorId && authorId === myAuthorId && custom) return custom;
      const published = authorDisplayName?.trim();
      if (published) return published;
      return pseudonymFromAuthorId(authorId);
    },
    [myAuthorId, topicDisplayName],
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
          setTopicDisplayNameSave({ kind: "error", message: toFriendlyMessage(result.error) });
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

  const selectedArgument = useMemo(() => {
    if (!selectedArgumentId) return null;
    return argumentById.get(selectedArgumentId) ?? null;
  }, [argumentById, selectedArgumentId]);

  // Fetch full argument detail (includes bodyRich) for the reader/edit flows.
  useEffect(() => {
    if (!selectedArgumentId) {
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
      const result = await apiClient.getArgument(selectedArgumentId, topicId);
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
  }, [refreshToken, selectedArgumentId]);

  useEffect(() => {
    setIsEditOpen(false);
    setEditError("");
    setIsSavingEdit(false);
    setEditTitle("");
  }, [selectedArgumentId]);

  const readArgument = useMemo(() => {
    if (!selectedArgumentId) return null;
    if (selectedArgumentDetail?.id === selectedArgumentId) return selectedArgumentDetail;
    return selectedArgument;
  }, [selectedArgument, selectedArgumentDetail, selectedArgumentId]);

  const canEditSelectedArgument =
    hasIdentity === true &&
    topicStatus === "active" &&
    myAuthorId !== null &&
    readArgument !== null &&
    readArgument.authorId === myAuthorId;

  const canOpenEdit =
    canEditSelectedArgument &&
    selectedArgumentDetail?.id === selectedArgumentId &&
    !isLoadingSelectedArgumentDetail &&
    !selectedArgumentDetailError;

  const rootArgumentId = tree.status === "success" ? tree.topic.rootArgumentId : null;
  const hasRestoredReplySelectionRef = useRef(false);
  const hasAutoOpenedManageRef = useRef(false);

  useEffect(() => {
    if (hasRestoredReplySelectionRef.current) return;
    if (tree.status !== "success") return;

    try {
      const lastParentId = draftStore.getReplyMeta(topicId)?.lastParentId ?? null;
      if (lastParentId && argumentById.has(lastParentId)) {
        setSelectedArgumentId(lastParentId);
      }
    } catch {
      // ignore
    }

    setIsReplyDraftHydrated(true);
    hasRestoredReplySelectionRef.current = true;
  }, [argumentById, draftStore, topicId, tree.status]);

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

  // Hide hover card when entering read mode
  useEffect(() => {
    lastPointerSideRef.current = null;
    setQuoteHint(null);
    if (selectedArgumentId) {
      setHoverCard(null);
      setActiveSide(null);
    }
  }, [selectedArgumentId]);

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (selectedArgumentId) return;

    const rect = leftColumnRef.current?.getBoundingClientRect();
    if (!rect) return;

    const side: "left" | "right" = event.clientX < rect.right ? "left" : "right";

    if (lastPointerSideRef.current === null) {
      // Start in the neutral layout; only switch after crossing the divider once.
      lastPointerSideRef.current = side;
      return;
    }

    if (side === lastPointerSideRef.current) return;
    lastPointerSideRef.current = side;
    setActiveSide(side);
  };

  useEffect(() => {
    if (!selectedArgumentId) return;

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
  }, [selectedArgumentId]);

  const sunburstSize = selectedArgumentId ? 240 : 360;

  const cardPosition = (x: number, y: number) => {
    const cardWidth = 280;
    const cardHeight = 180;
    const padding = 16;

    let left = x + padding;
    let top = y + padding;

    if (left + cardWidth > sunburstSize) left = x - cardWidth - padding;
    if (top + cardHeight > sunburstSize) top = y - cardHeight - padding;

    left = Math.max(padding, Math.min(left, sunburstSize - cardWidth - padding));
    top = Math.max(padding, Math.min(top, sunburstSize - cardHeight - padding));

    return { left, top };
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
        setReplyAutosave({ kind: "error", message: "本地缓存不可用" });
      }
    }
  }, [draftStore, topicId]);

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
        placeholder: "分享你的观点…",
      }),
      Typography,
      Underline,
      TipTapLink.configure({ openOnClick: false }),
    ],
    content: "",
    editorProps: {
      attributes: {
        "aria-label": "Reply",
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
        placeholder: "修改你的观点…",
      }),
      Typography,
      Underline,
      TipTapLink.configure({ openOnClick: false }),
    ],
    content: "",
    editorProps: {
      attributes: {
        "aria-label": "Edit argument",
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
      setEditError("");
      setEditText(editor.getText());
    },
  });

  useEffect(() => {
    editEditor?.setEditable(canEditSelectedArgument);
  }, [editEditor, canEditSelectedArgument]);

  useEffect(() => {
    if (!isEditOpen) return;
    if (!editEditor) return;
    if (!readArgument) return;

    const doc = readArgument.bodyRich ?? plainTextToTiptapDoc(readArgument.body);
    editEditor.commands.setContent(doc as any, true);
    setEditText(editEditor.getText());
    setEditTitle(readArgument.title ?? "");
    setEditError("");
  }, [editEditor, isEditOpen, readArgument?.id]);

  async function submitReply() {
    if (!replyEditor) return;
    if (!canCreateArgument) return;
    if (tree.status !== "success") return;

    const parentId = selectedArgumentId ?? tree.topic.rootArgumentId;
    if (!parentId) return;

    const body = replyText.trim();
    if (!body) {
      setReplyError("请输入观点内容");
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
      setReplyError(toFriendlyMessage(result.error));
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
    toast({ variant: "success", title: "post", message: "观点提交成功" });
  }

  async function submitEdit() {
    if (!editEditor) return;
    if (!canOpenEdit) return;
    if (!readArgument) return;

    const body = editEditor.getText().trim();
    if (!body) {
      setEditError("请输入观点内容");
      return;
    }

    setEditError("");
    setIsSavingEdit(true);

    const bodyRichResult = zTiptapDoc.safeParse(editEditor.getJSON());
    const bodyRich = bodyRichResult.success ? bodyRichResult.data : null;

    const result = await apiClient.editArgument(topicId, readArgument.id, {
      title: editTitle.trim() ? editTitle.trim() : null,
      body,
      bodyRich,
    });

    setIsSavingEdit(false);

    if (!result.ok) {
      setEditError(toFriendlyMessage(result.error));
      return;
    }

    setSelectedArgumentDetail(result.data.argument);
    invalidate();
    setIsEditOpen(false);
    toast({ variant: "success", title: "edit", message: "已更新" });
  }

  const insertQuote = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const targetEditor = isEditOpen ? editEditor : replyEditor;
      if (!targetEditor) return;

      if (!targetEditor.isEditable) {
        toast({ variant: "warn", title: "quote", message: "当前不可编辑" });
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
    [editEditor, isEditOpen, replyEditor, toast],
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (tree.status === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <P5Alert role="alert" variant="error" title="error">
          {tree.errorMessage}
        </P5Alert>
      </div>
    );
  }

  const topic = tree.topic;
  const argumentCount = Math.max(0, tree.arguments.length - 1);
  const currentVotes = selectedArgumentId ? stakesByArgumentId[selectedArgumentId] ?? 0 : 0;

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
      toast({ variant: "error", title: "claim", message: result.error.message });
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
    toast({ variant: "success", title: "host", message: "Host claimed for this topic." });
    invalidate();
  }

  return (
    <>
      {quoteHint ? (
        <P5Button
          size="sm"
          variant="ghost"
          className="fixed z-50 h-8 px-3 border border-border bg-background shadow-lg"
          style={{ left: quoteHint.x, top: quoteHint.y, transform: "translate(-100%, -120%)" }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={handleInsertQuote}
        >
          引用
        </P5Button>
      ) : null}
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6"
        onPointerMoveCapture={handlePointerMove}
        onPointerLeave={() => {
          if (!selectedArgumentId) {
            lastPointerSideRef.current = null;
            setActiveSide(null);
          }
        }}
      >
        {reloadRequired ? (
          <P5Alert title="reload_required" variant="warn" role="alert">
            <div className="flex items-center justify-between gap-3">
              <span>数据已更新，请刷新</span>
              <P5Button onClick={() => window.location.reload()} size="sm">
                刷新
              </P5Button>
            </div>
          </P5Alert>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm md:flex-row">
          {/* Left: Explorer */}
          <div
            ref={leftColumnRef}
            className={[
              "relative flex w-full flex-col overflow-hidden border-b border-border/60 bg-background transition-all duration-300 ease-out md:border-b-0 md:border-r",
              selectedArgumentId
                ? "md:w-[280px] md:min-w-[280px]"
                : activeSide === "left"
                  ? "md:w-[55%] md:min-w-[450px]"
                  : activeSide === "right"
                    ? "md:w-[300px] md:min-w-[300px]"
                    : "md:w-[420px] md:min-w-[420px]",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate font-serif text-xl text-foreground" title={topic.title}>
                  {topic.title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {argumentCount} nodes
                </p>
              </div>
              <P5Badge
                variant={topic.status === "active" ? "electric" : topic.status === "frozen" ? "acid" : "ink"}
              >
                {topic.status}
              </P5Badge>
            </div>

            <div
              className="flex flex-1 items-center justify-center overflow-hidden p-4"
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
                      setHoverCard(null);
                      setSelectedArgumentId(id);
                    }}
                    onHoverChange={(value) => {
                      if (!value || selectedArgumentId) {
                        setHoverCard(null);
                        return;
                      }
                      const arg = argumentById.get(value.id);
                      if (!arg) {
                        setHoverCard(null);
                        return;
                      }
                      setHoverCard({ argument: arg, x: value.pointer.x, y: value.pointer.y });
                    }}
                  />

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="max-w-[160px] text-center font-serif text-xs font-semibold text-foreground/90">
                      {topic.title.length > 12 ? `${topic.title.slice(0, 10)}…` : topic.title}
                    </span>
                  </div>

                  {hoverCard && !selectedArgumentId ? (
                    <div
                      className="pointer-events-none absolute z-10"
                      style={{ ...cardPosition(hoverCard.x, hoverCard.y), width: 280 }}
                    >
                      <div className="rounded-lg border border-border/60 bg-background p-4 shadow-lg">
                        <div className="mb-2">
                          <h3 className="font-serif text-base font-semibold text-foreground leading-tight">
                            {toTitle(hoverCard.argument)}
                          </h3>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                          {toExcerpt(hoverCard.argument.body)}
                        </p>

                        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                          <span title={hoverCard.argument.authorId}>
                            {authorLabel(hoverCard.argument.authorId, hoverCard.argument.authorDisplayName)}
                          </span>
                          <span>{hoverCard.argument.totalVotes} votes</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sunburst unavailable.</p>
              )}
            </div>

            <div className="border-t border-border/60 px-4 py-4">
              <P5Button
                variant="ghost"
                size="sm"
                className="w-full justify-center border border-border bg-background"
                onClick={() => setIsReportOpen(true)}
              >
                查看 AI 分析报告
              </P5Button>

              {claimError ? (
                <div className="mt-3">
                  <P5Alert role="alert" variant="error" title="claim">
                    {claimError}
                  </P5Alert>
                </div>
              ) : null}

              {claimInfo ? (
                <div className="mt-3">
                  <P5Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center border border-border"
                    onClick={claimOwner}
                    disabled={isClaiming}
                  >
                    {isClaiming ? "Claiming…" : "Claim Host"}
                  </P5Button>
                </div>
              ) : null}

              {isOwner ? (
                <div className="mt-3">
                  <P5Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center border border-border bg-background"
                    onClick={() => setIsManageOpen(true)}
                  >
                    Host 管理
                  </P5Button>
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <Link href="/" className="hover:text-foreground">
                  Hosted by Epiphany
                </Link>
                {identityFingerprint ? (
                  <Link
                    href="/my"
                    className="flex items-center gap-2 hover:text-foreground"
                    title={`我的身份 ${identityFingerprint}`}
                  >
                    {myAuthorId ? (
                      <span className="font-medium text-foreground/90">{authorLabel(myAuthorId)}</span>
                    ) : null}
                    <span className="font-mono text-[10px] text-muted-foreground/80">
                      {identityFingerprint}
                    </span>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          {/* Right: Reader */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            {readArgument ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="border-b border-border/60 px-6 py-6">
                  <h1 className="font-serif text-2xl leading-tight text-foreground">
                    {toTitle(readArgument)}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span title={readArgument.authorId}>
                        {authorLabel(readArgument.authorId, readArgument.authorDisplayName)}
                      </span>
                      <span aria-hidden className="text-border">
                        ·
                      </span>
                      <span>{new Date(readArgument.createdAt).toLocaleDateString()}</span>
                      <span aria-hidden className="text-border">
                        ·
                      </span>
                      <span>{readArgument.totalVotes} votes</span>
                    </div>

                    {canEditSelectedArgument ? (
                      <P5Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3 border border-border bg-background"
                        onClick={() => {
                          if (!canOpenEdit) return;
                          setIsEditOpen(true);
                        }}
                        disabled={!canOpenEdit}
                        title={
                          selectedArgumentDetailError
                            ? "加载失败"
                            : isLoadingSelectedArgumentDetail
                              ? "加载中…"
                              : "编辑"
                        }
                      >
                        {isLoadingSelectedArgumentDetail ? "加载中…" : "编辑"}
                      </P5Button>
                    ) : null}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
	                  <div className="mx-auto w-full max-w-[760px]">
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
                  </div>

                  {ledgerError ? (
                    <div className="mt-6">
                      <P5Alert role="alert" variant="error" title="ledger">
                        {ledgerError}
                      </P5Alert>
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
	                        <P5Input
	                          value={replyTitle}
	                          onChange={handleReplyTitleChange}
	                          placeholder="标题（可选）"
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
	                          <P5Button
	                            size="sm"
	                            variant="ghost"
	                            className="h-8 px-3 border border-border bg-background"
	                            onClick={() => setIsReplyEditorMode(true)}
	                          >
	                            显示工具栏
	                          </P5Button>
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
                            ? "自动保存中…"
                            : replyAutosave.kind === "saved"
                              ? `已自动保存 ${formatSavedTime(replyAutosave.savedAt) ?? ""}`.trim()
                              : replyAutosave.message}
                        </span>
                      ) : (
	                        <span />
	                      )}

	                      <div className="flex flex-col items-end gap-1">
	                        <div className="flex items-center gap-2">
                            <P5Input
                              value={topicDisplayName}
                              onChange={handleTopicDisplayNameChange}
                              placeholder="你在此议题的名字"
                              className="h-8 w-[180px] py-0 text-xs"
                              maxLength={40}
                              disabled={!hasIdentity}
                            />
                            <P5Button
                              variant="ink"
                              size="sm"
                              onClick={submitReply}
                              disabled={!canCreateArgument || isSubmittingReply || !replyText.trim()}
                            >
                              {isSubmittingReply ? "提交中…" : "提交"}
                            </P5Button>
                          </div>
                          {topicDisplayNameSave.kind !== "idle" ? (
                            <span
                              className={[
                                "text-[10px]",
                                topicDisplayNameSave.kind === "error" ? "text-destructive" : "text-muted-foreground",
                              ].join(" ")}
                            >
                              {topicDisplayNameSave.kind === "saving"
                                ? "名字保存中…"
                                : topicDisplayNameSave.kind === "saved"
                                  ? "名字已保存"
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
                <h2 className="font-serif text-2xl text-foreground">选择一个观点来探索</h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                  点击旭日图中的任意区块来查看详情并参与讨论。你也可以直接在下方提出一个新观点（默认发布在 root 下）。
                </p>

	                <div className="mt-8 w-full max-w-[760px]">
	                  <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
	                    <div className="border-b border-border/60 bg-background">
	                      <P5Input
	                        value={replyTitle}
	                        onChange={handleReplyTitleChange}
	                        placeholder="标题（可选）"
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
	                        <P5Button
	                          size="sm"
	                          variant="ghost"
	                          className="h-8 px-3 border border-border bg-background"
	                          onClick={() => setIsReplyEditorMode(true)}
	                        >
	                          显示工具栏
	                        </P5Button>
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
                          ? "自动保存中…"
                          : replyAutosave.kind === "saved"
                            ? `已自动保存 ${formatSavedTime(replyAutosave.savedAt) ?? ""}`.trim()
                            : replyAutosave.message}
                      </span>
                    ) : (
                      <span />
                    )}

                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <P5Input
                          value={topicDisplayName}
                          onChange={handleTopicDisplayNameChange}
                          placeholder="你在此议题的名字"
                          className="h-8 w-[180px] py-0 text-xs"
                          maxLength={40}
                          disabled={!hasIdentity}
                        />
                        <P5Button
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
                          {isSubmittingReply ? "提交中…" : "提交观点"}
                        </P5Button>
                      </div>
                      {topicDisplayNameSave.kind !== "idle" ? (
                        <span
                          className={[
                            "text-[10px]",
                            topicDisplayNameSave.kind === "error" ? "text-destructive" : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {topicDisplayNameSave.kind === "saving"
                            ? "名字保存中…"
                            : topicDisplayNameSave.kind === "saved"
                              ? "名字已保存"
                              : topicDisplayNameSave.message}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {topic.status !== "active" ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      该议题为只读（{topic.status}），无法新增观点；仍可撤回投票。
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <P5Modal
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="修改评论"
        maxWidth="760px"
        footer={
          <>
            <P5Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 border border-border bg-background"
              onClick={() => setIsEditOpen(false)}
              disabled={isSavingEdit}
            >
              取消
            </P5Button>
            <P5Button
              variant="ink"
              size="sm"
              onClick={submitEdit}
              disabled={!canOpenEdit || isSavingEdit || !editText.trim()}
            >
              {isSavingEdit ? "保存中…" : "保存修改"}
            </P5Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">修改后会重新触发 AI 分析</span>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-border/60 bg-background">
          <div className="border-b border-border/60 bg-background">
            <P5Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="标题（可选）"
              className="h-11 border-0 rounded-none shadow-none font-serif text-base"
              maxLength={160}
              disabled={isSavingEdit}
            />
          </div>
          {isEditEditorMode ? (
            <RichTextToolbar editor={editEditor} onRequestHideToolbar={() => setIsEditEditorMode(false)} />
          ) : (
            <div className="border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
              <P5Button
                size="sm"
                variant="ghost"
                className="h-8 px-3 border border-border bg-background"
                onClick={() => setIsEditEditorMode(true)}
              >
                显示工具栏
              </P5Button>
            </div>
          )}
          <EditorContent editor={editEditor} />
        </div>

        {editError ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {editError}
          </p>
        ) : null}
      </P5Modal>

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

      {isReportOpen ? (
        <ConsensusReportModal
          topicId={topicId}
          isOwner={isOwner}
          refreshToken={refreshToken}
          onInvalidate={invalidate}
          onClose={() => setIsReportOpen(false)}
        />
      ) : null}
    </>
  );
}
