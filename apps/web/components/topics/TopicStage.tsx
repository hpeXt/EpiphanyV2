"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { zTiptapDoc, type Argument, type LedgerMe } from "@epiphany/shared-contracts";
import TipTapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { ConsensusReportModal } from "@/components/topics/ConsensusReportModal";
import { useTopicSse } from "@/components/topics/hooks/useTopicSse";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Button } from "@/components/ui/P5Button";
import { P5Input } from "@/components/ui/P5Input";
import { useP5Toast } from "@/components/ui/P5ToastProvider";
import { TiptapRenderer } from "@/components/ui/TiptapRenderer";
import { Sunburst } from "@/components/visualizations/Sunburst";
import { authorIdFromPubkeyHex, deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
import { apiClient, type ApiError } from "@/lib/apiClient";
import { createLocalStorageKeyStore } from "@/lib/signing";
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

function formatAuthorFingerprint(authorId: string): string {
  if (authorId.length <= 10) return authorId;
  return `${authorId.slice(0, 6)}…${authorId.slice(-4)}`;
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

  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const visitedStore = useMemo(() => createLocalStorageVisitedTopicsStore(), []);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const lastPointerSideRef = useRef<"left" | "right" | null>(null);

  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);
  const [identityFingerprint, setIdentityFingerprint] = useState<string | null>(null);
  const [identityPubkeyHex, setIdentityPubkeyHex] = useState<string | null>(null);
  const [myAuthorId, setMyAuthorId] = useState<string | null>(null);
  const [topicDisplayName, setTopicDisplayName] = useState("");

  const [refreshToken, setRefreshToken] = useState(0);
  const invalidate = useCallback(() => setRefreshToken((prev) => prev + 1), []);

  const [reloadRequired, setReloadRequired] = useState(false);
  const handleReloadRequired = useCallback(() => setReloadRequired(true), []);

  useTopicSse({
    topicId,
    debounceMs: 3000,
    onInvalidation: invalidate,
    onReloadRequired: handleReloadRequired,
  });

  const tree = useTopicTree(topicId, 6, refreshToken);
  const topicStatus = tree.status === "success" ? tree.topic.status : "active";

  const [selectedArgumentId, setSelectedArgumentId] = useState<string | null>(null);
  const [activeSide, setActiveSide] = useState<"left" | "right" | null>(null);
  const [hoverCard, setHoverCard] = useState<HoverCardState | null>(null);

  const [ledger, setLedger] = useState<LedgerMe | null>(null);
  const [ledgerError, setLedgerError] = useState("");

  const [stakesByArgumentId, setStakesByArgumentId] = useState<Record<string, number>>({});
  const [isReportOpen, setIsReportOpen] = useState(false);

  const authorLabel = useCallback(
    (authorId: string) => {
      const custom = topicDisplayName.trim();
      if (myAuthorId && authorId === myAuthorId && custom) return custom;
      return pseudonymFromAuthorId(authorId);
    },
    [myAuthorId, topicDisplayName],
  );

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

  // Topic-scoped display name (local only for now)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`tm:topic-display-name:v1:${topicId}`);
      setTopicDisplayName(raw ?? "");
    } catch {
      setTopicDisplayName("");
    }
  }, [topicId]);

  useEffect(() => {
    try {
      const key = `tm:topic-display-name:v1:${topicId}`;
      if (topicDisplayName) localStorage.setItem(key, topicDisplayName);
      else localStorage.removeItem(key);
    } catch {
      // ignore storage errors
    }
  }, [topicDisplayName, topicId]);

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

  const rootArgumentId = tree.status === "success" ? tree.topic.rootArgumentId : null;

  const isOwner =
    hasIdentity === true &&
    identityPubkeyHex !== null &&
    tree.status === "success" &&
    tree.topic.ownerPubkey !== null &&
    identityPubkeyHex === tree.topic.ownerPubkey;

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
    if (selectedArgumentId) {
      setHoverCard(null);
      setActiveSide(null);
    }
  }, [selectedArgumentId]);

  const handleMouseMove = (event: React.MouseEvent<HTMLElement>) => {
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
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [isReplyEditorMode, setIsReplyEditorMode] = useState(false);

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
    },
  });

  useEffect(() => {
    replyEditor?.setEditable(canCreateArgument);
  }, [replyEditor, canCreateArgument]);

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
      title: null,
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
    replyEditor.commands.clearContent(true);
    setReplyText("");
    toast({ variant: "success", title: "post", message: "观点提交成功" });
  }

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

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
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
                            {authorLabel(hoverCard.argument.authorId)}
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
            {selectedArgument ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="border-b border-border/60 px-6 py-6">
                  <h1 className="font-serif text-2xl leading-tight text-foreground">
                    {toTitle(selectedArgument)}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span title={selectedArgument.authorId}>
                      {authorLabel(selectedArgument.authorId)}
                      <span className="ml-2 font-mono text-xs text-muted-foreground/80">
                        {formatAuthorFingerprint(selectedArgument.authorId)}
                      </span>
                    </span>
                    <span aria-hidden className="text-border">
                      ·
                    </span>
                    <span>{new Date(selectedArgument.createdAt).toLocaleDateString()}</span>
                    <span aria-hidden className="text-border">
                      ·
                    </span>
                    <span>{selectedArgument.totalVotes} votes</span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
                  <div className="mx-auto w-full max-w-[760px]">
                    <div
                      className={[
                        "prose prose-lg max-w-none",
                        "prose-headings:font-serif prose-headings:tracking-tight",
                        "prose-a:text-accent prose-a:underline prose-a:decoration-border/70 hover:prose-a:text-foreground",
                        "prose-blockquote:border-l-border prose-blockquote:text-muted-foreground",
                        "prose-code:before:content-none prose-code:after:content-none",
                        "prose-pre:rounded-md prose-pre:border prose-pre:border-border/60 prose-pre:bg-[color:var(--muted)]",
                      ].join(" ")}
                    >
                      {selectedArgument.bodyRich ? (
                        <TiptapRenderer
                          doc={selectedArgument.bodyRich}
                          fallback={selectedArgument.body}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{selectedArgument.body}</p>
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
                    argument={selectedArgument}
                    topicStatus={topic.status}
                    ledger={ledger}
                    currentVotes={currentVotes}
                    onLedgerUpdated={setLedger}
                    onVotesUpdated={(votes) => {
                      setStakesByArgumentId((prev) => ({ ...prev, [selectedArgument.id]: votes }));
                    }}
                    onInvalidate={invalidate}
                  />
                ) : null}

                <div className="border-t border-border/60 px-6 py-4">
                  <div className="mx-auto w-full max-w-[760px]">
                    <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                      {isReplyEditorMode ? (
                        <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 w-8 p-0 border border-border bg-background",
                              replyEditor?.isActive("bold") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleBold().run()}
                            aria-label="Bold"
                          >
                            B
                          </P5Button>
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 w-8 p-0 border border-border bg-background italic",
                              replyEditor?.isActive("italic") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleItalic().run()}
                            aria-label="Italic"
                          >
                            I
                          </P5Button>
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 w-8 p-0 border border-border bg-background underline",
                              replyEditor?.isActive("underline") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleUnderline().run()}
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
                              replyEditor?.isActive("heading", { level: 2 }) ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleHeading({ level: 2 }).run()}
                            aria-label="Heading 2"
                          >
                            H2
                          </P5Button>
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 px-2 border border-border bg-background",
                              replyEditor?.isActive("heading", { level: 3 }) ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleHeading({ level: 3 }).run()}
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
                              replyEditor?.isActive("bulletList") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleBulletList().run()}
                            aria-label="Bullet list"
                          >
                            •
                          </P5Button>
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 px-2 border border-border bg-background",
                              replyEditor?.isActive("orderedList") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleOrderedList().run()}
                            aria-label="Ordered list"
                          >
                            1.
                          </P5Button>
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 px-2 border border-border bg-background",
                              replyEditor?.isActive("blockquote") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleBlockquote().run()}
                            aria-label="Blockquote"
                          >
                            “
                          </P5Button>
                          <P5Button
                            size="sm"
                            variant="ghost"
                            className={[
                              "h-8 px-2 border border-border bg-background font-mono",
                              replyEditor?.isActive("codeBlock") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => replyEditor?.chain().focus().toggleCodeBlock().run()}
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
                              replyEditor?.isActive("link") ? "bg-muted" : "",
                            ].join(" ")}
                            onClick={() => {
                              if (!replyEditor) return;
                              const previousUrl = replyEditor.getAttributes("link").href as string | undefined;
                              const nextUrl = window.prompt("Link URL", previousUrl ?? "");
                              if (nextUrl === null) return;
                              const trimmed = nextUrl.trim();
                              if (!trimmed) {
                                replyEditor.chain().focus().unsetLink().run();
                                return;
                              }
                              replyEditor
                                .chain()
                                .focus()
                                .extendMarkRange("link")
                                .setLink({ href: trimmed })
                                .run();
                            }}
                            aria-label="Link"
                          >
                            ↗
                          </P5Button>
                        </div>
                      ) : null}

                      <EditorContent editor={replyEditor} />
                    </div>

                    {replyError ? (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        {replyError}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <P5Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3 border border-border bg-background"
                        onClick={() => setIsReplyEditorMode((prev) => !prev)}
                      >
                        {isReplyEditorMode ? "简洁" : "编辑器"}
                      </P5Button>

                      <div className="flex items-center gap-2">
                        <P5Input
                          value={topicDisplayName}
                          onChange={(e) => setTopicDisplayName(e.target.value)}
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
                    {isReplyEditorMode ? (
                      <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-[color:var(--muted)] px-3 py-2">
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 w-8 p-0 border border-border bg-background",
                            replyEditor?.isActive("bold") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleBold().run()}
                          aria-label="Bold"
                        >
                          B
                        </P5Button>
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 w-8 p-0 border border-border bg-background italic",
                            replyEditor?.isActive("italic") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleItalic().run()}
                          aria-label="Italic"
                        >
                          I
                        </P5Button>
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 w-8 p-0 border border-border bg-background underline",
                            replyEditor?.isActive("underline") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleUnderline().run()}
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
                            replyEditor?.isActive("heading", { level: 2 }) ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleHeading({ level: 2 }).run()}
                          aria-label="Heading 2"
                        >
                          H2
                        </P5Button>
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 px-2 border border-border bg-background",
                            replyEditor?.isActive("heading", { level: 3 }) ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleHeading({ level: 3 }).run()}
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
                            replyEditor?.isActive("bulletList") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleBulletList().run()}
                          aria-label="Bullet list"
                        >
                          •
                        </P5Button>
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 px-2 border border-border bg-background",
                            replyEditor?.isActive("orderedList") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleOrderedList().run()}
                          aria-label="Ordered list"
                        >
                          1.
                        </P5Button>
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 px-2 border border-border bg-background",
                            replyEditor?.isActive("blockquote") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleBlockquote().run()}
                          aria-label="Blockquote"
                        >
                          “
                        </P5Button>
                        <P5Button
                          size="sm"
                          variant="ghost"
                          className={[
                            "h-8 px-2 border border-border bg-background font-mono",
                            replyEditor?.isActive("codeBlock") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => replyEditor?.chain().focus().toggleCodeBlock().run()}
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
                            replyEditor?.isActive("link") ? "bg-muted" : "",
                          ].join(" ")}
                          onClick={() => {
                            if (!replyEditor) return;
                            const previousUrl = replyEditor.getAttributes("link").href as string | undefined;
                            const nextUrl = window.prompt("Link URL", previousUrl ?? "");
                            if (nextUrl === null) return;
                            const trimmed = nextUrl.trim();
                            if (!trimmed) {
                              replyEditor.chain().focus().unsetLink().run();
                              return;
                            }
                            replyEditor
                              .chain()
                              .focus()
                              .extendMarkRange("link")
                              .setLink({ href: trimmed })
                              .run();
                          }}
                          aria-label="Link"
                        >
                          ↗
                        </P5Button>
                      </div>
                    ) : null}

                    <EditorContent editor={replyEditor} />
                  </div>

                  {replyError ? (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      {replyError}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <P5Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 border border-border bg-background"
                      onClick={() => setIsReplyEditorMode((prev) => !prev)}
                    >
                      {isReplyEditorMode ? "简洁" : "编辑器"}
                    </P5Button>

                    <div className="flex items-center gap-2">
                      <P5Input
                        value={topicDisplayName}
                        onChange={(e) => setTopicDisplayName(e.target.value)}
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
