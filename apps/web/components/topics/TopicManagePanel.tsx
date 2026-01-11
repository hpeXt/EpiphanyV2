"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { TopicCommand } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";
import { createLocalStorageDraftStore } from "@/lib/draftStore";
import { createLocalStorageTopicAccessKeyStore } from "@/lib/topicAccessKeyStore";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { useP5Confirm } from "@/components/ui/P5ConfirmProvider";
import { P5Input } from "@/components/ui/P5Input";
import { P5Textarea } from "@/components/ui/P5Textarea";
import { useP5Toast } from "@/components/ui/P5ToastProvider";

type Props = {
  topicId: string;
  topicTitle: string;
  topicStatus: "active" | "frozen" | "archived";
  topicVisibility: "public" | "unlisted" | "private";
  rootBody: string;
  defaultArgumentId?: string | null;
  onInvalidate: () => void;
  onClose: () => void;
};

function normalizeHex(input: string): string {
  return input.trim().toLowerCase();
}

function isValidPubkeyHex(pubkeyHex: string): boolean {
  return /^[0-9a-f]{64}$/.test(pubkeyHex);
}

function formatSavedTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TopicManagePanel({
  topicId,
  topicTitle,
  topicStatus,
  topicVisibility,
  rootBody,
  defaultArgumentId,
  onInvalidate,
  onClose,
}: Props) {
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { confirm } = useP5Confirm();
  const { toast } = useP5Toast();
  const draftStore = useMemo(() => createLocalStorageDraftStore(), []);
  const accessKeyStore = useMemo(() => createLocalStorageTopicAccessKeyStore(), []);

  const [nextTitle, setNextTitle] = useState(topicTitle);
  const [nextBody, setNextBody] = useState(rootBody);
  const [isRootDraftHydrated, setIsRootDraftHydrated] = useState(false);
  const [privateAccessKey, setPrivateAccessKey] = useState<string | null>(null);

  const [pruneArgumentId, setPruneArgumentId] = useState(defaultArgumentId ?? "");
  const [pruneReason, setPruneReason] = useState("");

  const [blacklistPubkey, setBlacklistPubkey] = useState("");
  const [blacklistReason, setBlacklistReason] = useState("");

  const canManage = topicStatus === "active";
  const canUnfreeze = topicStatus === "frozen";
  const canManagePrivacy = canManage;

  type AutosaveState =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; savedAt: string }
    | { kind: "error"; message: string };

  const [rootAutosave, setRootAutosave] = useState<AutosaveState>({ kind: "idle" });
  const rootAutosaveTimerRef = useRef<number | null>(null);
  const rootAutosavePendingRef = useRef<{ title: string; body: string } | null>(null);
  const skipRootAutosaveRef = useRef(false);
  const hydratedTopicIdRef = useRef<string | null>(null);

  const commitPendingRootDraft = useCallback((options?: { silent?: boolean }) => {
    if (rootAutosaveTimerRef.current !== null) {
      window.clearTimeout(rootAutosaveTimerRef.current);
      rootAutosaveTimerRef.current = null;
    }

    const pending = rootAutosavePendingRef.current;
    if (!pending) return;
    rootAutosavePendingRef.current = null;

    try {
      const saved = draftStore.setEditRootDraft(topicId, pending);
      if (options?.silent) return;

      if (!saved) {
        setRootAutosave({ kind: "idle" });
        return;
      }
      setRootAutosave({ kind: "saved", savedAt: saved.updatedAt });
    } catch {
      if (!options?.silent) {
        setRootAutosave({ kind: "error", message: "本地缓存不可用" });
      }
    }
  }, [draftStore, topicId]);

  const statusActions = useMemo(() => {
    if (topicStatus === "active") {
      return [
        {
          label: "Freeze",
          command: { type: "SET_STATUS", payload: { status: "frozen" } } as const,
        },
        {
          label: "Archive",
          command: { type: "SET_STATUS", payload: { status: "archived" } } as const,
        },
      ];
    }
    if (topicStatus === "frozen") {
      return [
        {
          label: "Unfreeze",
          command: { type: "SET_STATUS", payload: { status: "active" } } as const,
        },
      ];
    }
    return [];
  }, [topicStatus]);

  useEffect(() => {
    if (topicVisibility !== "private") {
      setPrivateAccessKey(null);
      return;
    }
    try {
      setPrivateAccessKey(accessKeyStore.get(topicId));
    } catch {
      setPrivateAccessKey(null);
    }
  }, [accessKeyStore, topicId, topicVisibility]);

  useEffect(() => {
    if (hydratedTopicIdRef.current === topicId) return;
    hydratedTopicIdRef.current = topicId;

    setIsRootDraftHydrated(false);
    skipRootAutosaveRef.current = true;

    try {
      const draft = draftStore.getEditRootDraft(topicId);
      if (draft) {
        setNextTitle(draft.title);
        setNextBody(draft.body);
        setRootAutosave({ kind: "saved", savedAt: draft.updatedAt });
      } else {
        setNextTitle(topicTitle);
        setNextBody(rootBody);
        setRootAutosave({ kind: "idle" });
      }
    } catch {
      setNextTitle(topicTitle);
      setNextBody(rootBody);
      setRootAutosave({ kind: "error", message: "本地缓存不可用" });
    }

    setIsRootDraftHydrated(true);
    window.setTimeout(() => {
      skipRootAutosaveRef.current = false;
    }, 0);
  }, [draftStore, rootBody, topicId, topicTitle]);

  useEffect(() => {
    if (!isRootDraftHydrated) return;
    if (skipRootAutosaveRef.current) return;
    if (!canManage) return;

    rootAutosavePendingRef.current = { title: nextTitle, body: nextBody };
    setRootAutosave({ kind: "saving" });

    if (rootAutosaveTimerRef.current !== null) {
      window.clearTimeout(rootAutosaveTimerRef.current);
    }
    rootAutosaveTimerRef.current = window.setTimeout(() => {
      rootAutosaveTimerRef.current = null;
      commitPendingRootDraft({ silent: false });
    }, 800);
  }, [canManage, commitPendingRootDraft, isRootDraftHydrated, nextBody, nextTitle]);

  useEffect(() => {
    return () => {
      commitPendingRootDraft({ silent: true });
    };
  }, [commitPendingRootDraft]);

  async function runCommand(command: TopicCommand): Promise<{ ok: boolean; accessKey?: string }> {
    setSubmitError("");

    if (command.type === "SET_STATUS" && command.payload.status === "archived") {
      const ok = await confirm({
        title: "Archive topic",
        message: "This will make the topic permanently read-only.\n\nContinue?",
        confirmLabel: "Archive",
        variant: "danger",
      });
      if (!ok) return { ok: false };
    }

    setIsSubmitting(true);
    const result = await apiClient.executeTopicCommand(topicId, command);
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      toast({ variant: "error", title: "host", message: result.error.message });
      return { ok: false };
    }

    if (result.data.accessKey) {
      try {
        accessKeyStore.set(topicId, result.data.accessKey);
        setPrivateAccessKey(result.data.accessKey);
      } catch {
        // ignore localStorage errors
      }
    } else if (command.type === "SET_VISIBILITY" && command.payload.visibility !== "private") {
      try {
        accessKeyStore.remove(topicId);
      } catch {
        // ignore
      }
      setPrivateAccessKey(null);
    }

    onInvalidate();
    toast({ variant: "success", title: "host", message: "Command applied." });
    return { ok: true, ...(result.data.accessKey ? { accessKey: result.data.accessKey } : {}) };
  }

  async function onSubmitEditRoot(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    commitPendingRootDraft({ silent: true });

    const result = await runCommand({
      type: "EDIT_ROOT",
      payload: { title: nextTitle, body: nextBody },
    });

    if (result.ok) {
      try {
        draftStore.removeEditRootDraft(topicId);
      } catch {
        // ignore
      }
      setRootAutosave({ kind: "idle" });
    }
  }

  async function blacklist() {
    if (!canManage) return;

    const pubkey = normalizeHex(blacklistPubkey);
    if (!isValidPubkeyHex(pubkey)) {
      setSubmitError("pubkey must be 64 hex chars");
      return;
    }

    const ok = await confirm({
      title: "Blacklist pubkey",
      message:
        "This will block the pubkey from writing (createArgument/setVotes) in this topic.\n\nContinue?",
      confirmLabel: "Blacklist",
      variant: "danger",
    });
    if (!ok) return;

    await runCommand({
      type: "BLACKLIST_PUBKEY",
      payload: {
        pubkey,
        reason: blacklistReason.trim() ? blacklistReason.trim() : null,
      },
    });
  }

  async function unblacklist() {
    if (!canManage) return;

    const pubkey = normalizeHex(blacklistPubkey);
    if (!isValidPubkeyHex(pubkey)) {
      setSubmitError("pubkey must be 64 hex chars");
      return;
    }

    await runCommand({
      type: "UNBLACKLIST_PUBKEY",
      payload: { pubkey },
    });
  }

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (!privateAccessKey) return "";
    return `${window.location.origin}/topics/${topicId}#k=${privateAccessKey}`;
  }, [privateAccessKey, topicId]);

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ variant: "success", title: "privacy", message: "Share link copied." });
    } catch {
      toast({ variant: "error", title: "privacy", message: "Copy failed." });
    }
  }, [shareUrl, toast]);

  return (
    <div
      role="dialog"
      aria-label="Host deck"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-rebel)]"
        style={{
          clipPath:
            "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            Host Deck
          </h2>
          <P5Button
            type="button"
            onClick={onClose}
            size="sm"
            className="border-[color:var(--paper)] text-[color:var(--paper)] shadow-none hover:bg-white/10"
          >
            Close
          </P5Button>
        </div>

        <div className="max-h-[80vh] space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <p className="text-sm text-[color:var(--ink)]">
              Status: <span className="font-mono">{topicStatus}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {statusActions.map((action) => (
                <P5Button
                  key={action.label}
                  type="button"
                  disabled={isSubmitting || topicStatus === "archived"}
                  onClick={() => runCommand(action.command)}
                  size="sm"
                  className="border-[3px] shadow-[2px_2px_0_var(--ink)]"
                >
                  {action.label}
                </P5Button>
              ))}
              {topicStatus === "archived" ? (
                <span className="text-sm text-[color:var(--ink)]/70">
                  Archived topics are read-only.
                </span>
              ) : null}
            </div>
            {canUnfreeze ? (
              <p className="text-sm text-[color:var(--ink)]/80">
                Frozen topics only allow unfreeze.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wide text-[color:var(--ink)]">
              Visibility
            </h3>
            <p className="text-sm text-[color:var(--ink)]">
              Current: <span className="font-mono">{topicVisibility}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {(["public", "unlisted", "private"] as const).map((value) => (
                <P5Button
                  key={value}
                  type="button"
                  size="sm"
                  disabled={!canManagePrivacy || isSubmitting || topicVisibility === value}
                  onClick={() => runCommand({ type: "SET_VISIBILITY", payload: { visibility: value } })}
                >
                  {value}
                </P5Button>
              ))}
              {topicVisibility === "private" ? (
                <P5Button
                  type="button"
                  size="sm"
                  disabled={!canManagePrivacy || isSubmitting}
                  onClick={() => runCommand({ type: "ROTATE_ACCESS_KEY", payload: {} })}
                >
                  Rotate key
                </P5Button>
              ) : null}
              {topicVisibility === "private" && shareUrl ? (
                <P5Button
                  type="button"
                  size="sm"
                  disabled={!shareUrl}
                  onClick={copyShareUrl}
                  variant="primary"
                >
                  Copy link
                </P5Button>
              ) : null}
            </div>
            {topicVisibility === "private" ? (
              shareUrl ? (
                <p className="break-all font-mono text-xs text-[color:var(--ink)]/80">{shareUrl}</p>
              ) : (
                <p className="text-sm text-[color:var(--ink)]/70">
                  Access key is only shown once (on set private / rotate).
                </p>
              )
            ) : (
              <p className="text-sm text-[color:var(--ink)]/70">
                public topics are listed; unlisted topics require topicId; private topics require #k=… or prior participation.
              </p>
            )}
          </div>

          <form onSubmit={onSubmitEditRoot} className="space-y-2">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wide text-[color:var(--ink)]">
              Root
            </h3>
            <div className="space-y-1">
              <label htmlFor="root-title" className="text-sm font-semibold text-[color:var(--ink)]">
                Root title
              </label>
              <P5Input
                id="root-title"
                value={nextTitle}
                onChange={(event) => setNextTitle(event.target.value)}
                disabled={!canManage || isSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="root-body" className="text-sm font-semibold text-[color:var(--ink)]">
                Root body
              </label>
              <P5Textarea
                id="root-body"
                value={nextBody}
                onChange={(event) => setNextBody(event.target.value)}
                disabled={!canManage || isSubmitting}
                rows={4}
              />
            </div>
            <P5Button type="submit" disabled={!canManage || isSubmitting} variant="primary">
              Save root
            </P5Button>
            {rootAutosave.kind !== "idle" ? (
              <p
                className={[
                  "text-xs",
                  rootAutosave.kind === "error"
                    ? "text-[color:var(--rebel-red)]"
                    : "text-[color:var(--ink)]/60",
                ].join(" ")}
              >
                {rootAutosave.kind === "saving"
                  ? "自动保存中…"
                  : rootAutosave.kind === "saved"
                    ? `已自动保存 ${formatSavedTime(rootAutosave.savedAt) ?? ""}`.trim()
                    : rootAutosave.message}
              </p>
            ) : null}
          </form>

          <div className="space-y-2">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wide text-[color:var(--ink)]">
              Pruning
            </h3>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="prune-argument-id"
                  className="text-sm font-semibold text-[color:var(--ink)]"
                >
                  Argument ID
                </label>
                <P5Input
                  id="prune-argument-id"
                  value={pruneArgumentId}
                  onChange={(event) => setPruneArgumentId(event.target.value)}
                  disabled={!canManage || isSubmitting}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="prune-reason"
                  className="text-sm font-semibold text-[color:var(--ink)]"
                >
                  Prune reason (optional)
                </label>
                <P5Input
                  id="prune-reason"
                  value={pruneReason}
                  onChange={(event) => setPruneReason(event.target.value)}
                  disabled={!canManage || isSubmitting}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <P5Button
                type="button"
                disabled={!canManage || isSubmitting || !pruneArgumentId.trim()}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Prune argument",
                    message:
                      "This will hide the argument from public reads (stakes can still be withdrawn).\n\nContinue?",
                    confirmLabel: "Prune",
                    variant: "danger",
                  });
                  if (!ok) return;
                  await runCommand({
                    type: "PRUNE_ARGUMENT",
                    payload: {
                      argumentId: pruneArgumentId.trim(),
                      reason: pruneReason.trim() ? pruneReason.trim() : null,
                    },
                  });
                }}
                variant="danger"
                size="sm"
              >
                Prune
              </P5Button>
              <P5Button
                type="button"
                disabled={!canManage || isSubmitting || !pruneArgumentId.trim()}
                onClick={() =>
                  runCommand({
                    type: "UNPRUNE_ARGUMENT",
                    payload: { argumentId: pruneArgumentId.trim() },
                  })
                }
                size="sm"
              >
                Unprune
              </P5Button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wide text-[color:var(--ink)]">
              Blacklist
            </h3>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="blacklist-pubkey"
                  className="text-sm font-semibold text-[color:var(--ink)]"
                >
                  Target pubkey (hex)
                </label>
                <P5Input
                  id="blacklist-pubkey"
                  value={blacklistPubkey}
                  onChange={(event) => setBlacklistPubkey(event.target.value)}
                  disabled={!canManage || isSubmitting}
                  placeholder="64 hex chars"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="blacklist-reason"
                  className="text-sm font-semibold text-[color:var(--ink)]"
                >
                  Blacklist reason (optional)
                </label>
                <P5Input
                  id="blacklist-reason"
                  value={blacklistReason}
                  onChange={(event) => setBlacklistReason(event.target.value)}
                  disabled={!canManage || isSubmitting}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <P5Button
                type="button"
                disabled={!canManage || isSubmitting || !blacklistPubkey.trim()}
                onClick={blacklist}
                variant="danger"
                size="sm"
              >
                Blacklist
              </P5Button>
              <P5Button
                type="button"
                disabled={!canManage || isSubmitting || !blacklistPubkey.trim()}
                onClick={unblacklist}
                size="sm"
              >
                Unblacklist
              </P5Button>
            </div>
          </div>

          {submitError ? (
            <P5Alert role="alert" variant="error" title="error">
              {submitError}
            </P5Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}
