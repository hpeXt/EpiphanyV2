"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { zTiptapDoc, type LedgerMe, type TiptapDoc } from "@epiphany/shared-contracts";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { useChildren, type ChildrenOrderBy } from "@/components/topics/hooks/useChildren";
import { apiClient, type ApiError } from "@/lib/apiClient";
import { createLocalStorageDraftStore } from "@/lib/draftStore";
import { plainTextToTiptapDoc } from "@/lib/tiptap";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { P5Tabs } from "@/components/ui/P5Tabs";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  topicId: string;
  parentArgumentId: string | null;
  topicStatus: "active" | "frozen" | "archived";
  refreshToken: number;
  onInvalidate: () => void;
  canWrite: boolean;
  ledger: LedgerMe | null;
  onLedgerUpdated: (ledger: LedgerMe) => void;
};

function toToggleLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  orderBy: ChildrenOrderBy,
) {
  return orderBy === "totalVotes_desc" ? t("dialogue.hottest") : t("dialogue.newest");
}

function toLabel(input: { title: string | null; body: string; id: string }): string {
  if (input.title) return input.title;
  const trimmed = input.body.trim();
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return input.id;
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

function formatSavedTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function VoteControl(props: {
  topicId: string;
  argumentId: string;
  topicStatus: "active" | "frozen" | "archived";
  argumentPrunedAt: string | null;
  onLedgerUpdated: (ledger: LedgerMe) => void;
}) {
  const { t } = useI18n();
  const [currentVotes, setCurrentVotes] = useState(0);
  const [targetVotes, setTargetVotes] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentCost = currentVotes * currentVotes;
  const targetCost = targetVotes * targetVotes;
  const deltaCost = targetCost - currentCost;
  const isIncrease = targetVotes > currentVotes;
  const increaseForbidden =
    props.topicStatus !== "active" || Boolean(props.argumentPrunedAt);
  const disableSubmit = isSubmitting || (increaseForbidden && isIncrease);

  async function submitVotes() {
    setSubmitError("");
    setIsSubmitting(true);
    const result = await apiClient.setVotes(props.topicId, props.argumentId, {
      targetVotes,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(toFriendlyMessage(t, result.error));
      return;
    }

    setCurrentVotes(result.data.targetVotes);
    setTargetVotes(result.data.targetVotes);
    props.onLedgerUpdated(result.data.ledger);
  }

  return (
    <div className="space-y-2 pt-2">
      <label
        htmlFor={`votes-${props.argumentId}`}
        className="text-xs font-semibold text-[color:var(--ink)]"
      >
        {t("dialogue.votes")}
      </label>
      <input
        id={`votes-${props.argumentId}`}
        aria-label={t("dialogue.votes")}
        type="range"
        min={0}
        max={10}
        step={1}
        value={targetVotes}
        onChange={(event) => setTargetVotes(Number(event.target.value))}
        className="w-full"
      />
      {increaseForbidden ? (
        <p className="text-xs text-[color:var(--ink)]/70">
          {props.argumentPrunedAt
            ? t("dialogue.nodePruned")
            : t("dialogue.topicReadOnly")}
        </p>
      ) : null}
      <p className="text-xs text-[color:var(--ink)]/80">
        {t("dialogue.cost")}: {targetCost} ({t("dialogue.deltaCost")}: {formatDelta(deltaCost)})
      </p>

      {submitError ? (
        <p role="alert" className="text-xs text-[color:var(--rebel-red)]">
          {submitError}
        </p>
      ) : null}

      <P5Button
        type="button"
        onClick={submitVotes}
        disabled={disableSubmit}
        size="sm"
        className="border-[3px] px-2 py-1 text-xs shadow-[2px_2px_0_var(--ink)]"
      >
        {isSubmitting ? t("common.saving") : t("common.save")}
      </P5Button>
    </div>
  );
}

export function DialogueStream({
  topicId,
  parentArgumentId,
  topicStatus,
  refreshToken,
  canWrite,
  ledger,
  onLedgerUpdated,
}: Props) {
  const { t } = useI18n();
  const [orderBy, setOrderBy] = useState<ChildrenOrderBy>("totalVotes_desc");
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  const draftStore = useMemo(() => createLocalStorageDraftStore(), []);

  type AutosaveState =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; savedAt: string }
    | { kind: "error"; message: string };

  const [replyAutosave, setReplyAutosave] = useState<AutosaveState>({ kind: "idle" });
  const replyAutosaveTimerRef = useRef<number | null>(null);
  const replyAutosavePendingRef = useRef<{
    parentId: string;
    body: string;
    bodyRich: TiptapDoc | null;
  } | null>(null);
  const skipReplyAutosaveRef = useRef(false);
  const parentArgumentIdRef = useRef<string | null>(null);
  parentArgumentIdRef.current = parentArgumentId;

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
        body: pending.body,
        bodyRich: pending.bodyRich,
      });
      draftStore.setReplyMeta(topicId, { lastParentId: pending.parentId });

      if (options?.silent) return;

      if (!saved) {
        setReplyAutosave({ kind: "idle" });
        return;
      }

      setReplyAutosave({ kind: "saved", savedAt: saved.updatedAt });
    } catch {
      if (!options?.silent) {
        setReplyAutosave({ kind: "error", message: t("errors.localStorageUnavailable") });
      }
    }
  }, [draftStore, t, topicId]);

  const canCreateArgument = canWrite && topicStatus === "active";

  const replyEditor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false }),
    ],
    content: "",
    editorProps: {
      attributes: {
        "aria-label": t("dialogue.replyLabel"),
        class: [
          "min-h-[96px] w-full px-3 py-2 text-sm text-zinc-900 outline-none",
          "prose prose-sm max-w-none",
        ].join(" "),
      },
    },
    onUpdate: ({ editor }) => {
      setReplyText(editor.getText());

      if (skipReplyAutosaveRef.current) return;
      const parentId = parentArgumentIdRef.current;
      if (!parentId) return;

      const body = editor.getText();
      const bodyRich = editor.getJSON() as unknown as TiptapDoc;
      replyAutosavePendingRef.current = { parentId, body, bodyRich: bodyRich ?? null };
      setReplyAutosave({ kind: "saving" });

      if (replyAutosaveTimerRef.current !== null) {
        window.clearTimeout(replyAutosaveTimerRef.current);
      }
      replyAutosaveTimerRef.current = window.setTimeout(() => {
        replyAutosaveTimerRef.current = null;
        commitPendingReplyDraft({ silent: false });
      }, 800);
    },
  });

  useEffect(() => {
    replyEditor?.setEditable(canCreateArgument);
  }, [replyEditor, canCreateArgument]);

  useEffect(() => {
    setOrderBy("totalVotes_desc");
    setReplyError("");

    if (!replyEditor) return;

    commitPendingReplyDraft({ silent: true });

    skipReplyAutosaveRef.current = true;

    if (!parentArgumentId) {
      replyEditor.commands.clearContent(true);
      setReplyText("");
      setReplyAutosave({ kind: "idle" });
      window.setTimeout(() => {
        skipReplyAutosaveRef.current = false;
      }, 0);
      return;
    }

    let draft = null;
    try {
      draft = draftStore.getReplyDraft(topicId, parentArgumentId);
    } catch {
      draft = null;
    }

    const nextDoc = (() => {
      if (!draft) return null;
      const parsed = draft.bodyRich ? zTiptapDoc.safeParse(draft.bodyRich) : null;
      if (parsed?.success) return parsed.data;
      return draft.body.trim() ? plainTextToTiptapDoc(draft.body) : null;
    })();

    if (nextDoc) {
      replyEditor.commands.setContent(nextDoc as any, true);
      setReplyAutosave({ kind: "saved", savedAt: draft?.updatedAt ?? new Date().toISOString() });
      setReplyText(draft?.body ?? "");
    } else {
      replyEditor.commands.clearContent(true);
      setReplyText("");
      setReplyAutosave({ kind: "idle" });
    }

    window.setTimeout(() => {
      skipReplyAutosaveRef.current = false;
    }, 0);
  }, [commitPendingReplyDraft, draftStore, parentArgumentId, replyEditor, topicId]);

  useEffect(() => {
    return () => {
      commitPendingReplyDraft({ silent: true });
    };
  }, [commitPendingReplyDraft]);

  const children = useChildren({
    topicId,
    parentArgumentId,
    orderBy,
    limit: 30,
    refreshToken,
  });

  const canPost = useMemo(
    () => Boolean(parentArgumentId && replyText.trim()),
    [parentArgumentId, replyText],
  );

  async function onSubmitReply(event: FormEvent) {
    event.preventDefault();
    if (!parentArgumentId) return;
    if (!canCreateArgument) return;
    commitPendingReplyDraft({ silent: true });
    setReplyError("");

    const body = replyText.trim();
    if (!body) {
      setReplyError(t("dialogue.replyRequired"));
      return;
    }

    setIsSubmittingReply(true);
    const bodyRichResult = replyEditor ? zTiptapDoc.safeParse(replyEditor.getJSON()) : null;
    const bodyRich = bodyRichResult && bodyRichResult.success ? bodyRichResult.data : null;
    const result = await apiClient.createArgument(topicId, {
      parentId: parentArgumentId,
      title: null,
      body,
      bodyRich,
      initialVotes: 0,
    });
    setIsSubmittingReply(false);

    if (!result.ok) {
      setReplyError(toFriendlyMessage(t, result.error));
      skipReplyAutosaveRef.current = true;
      replyEditor?.commands.clearContent(true);
      setReplyText("");
      window.setTimeout(() => {
        skipReplyAutosaveRef.current = false;
      }, 0);
      return;
    }

    onLedgerUpdated(result.data.ledger);
    children.prependItem({
      id: result.data.argument.id,
      label: toLabel(result.data.argument),
      prunedAt: result.data.argument.prunedAt,
    });
    try {
      draftStore.removeReplyDraft(topicId, parentArgumentId);
      draftStore.setReplyMeta(topicId, { lastParentId: parentArgumentId });
    } catch {
      // ignore
    }
    setReplyAutosave({ kind: "idle" });
    skipReplyAutosaveRef.current = true;
    replyEditor?.commands.clearContent(true);
    setReplyText("");
    window.setTimeout(() => {
      skipReplyAutosaveRef.current = false;
    }, 0);
  }

  return (
    <P5Panel
      bodyClassName="space-y-3"
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            {t("dialogue.title")}
          </h2>

          {parentArgumentId ? (
            <P5Tabs
              ariaLabel={t("dialogue.orderLabel")}
              value={orderBy}
              onValueChange={setOrderBy}
              tabs={[
                { value: "totalVotes_desc", label: t("dialogue.hottest") },
                { value: "createdAt_desc", label: t("dialogue.newest") },
              ]}
              className="shadow-none"
            />
          ) : null}
        </div>
      }
    >
      {!parentArgumentId ? (
        <P5Alert role="status" variant="info" title={t("dialogue.title")}>
          {t("dialogue.selectNodeHint")}
        </P5Alert>
      ) : null}

      {parentArgumentId && children.status === "error" ? (
        <P5Alert role="alert" variant="error" title={t("common.error")}>
          {children.errorMessage}
        </P5Alert>
      ) : null}

      {parentArgumentId && children.status === "loading" ? (
        <p className="text-sm text-[color:var(--ink)]/80">
          {t("dialogue.loadingReplies", { order: toToggleLabel(t, orderBy) })}
        </p>
      ) : null}

      {parentArgumentId && children.status === "success" ? (
        <div className="space-y-3">
          {canWrite ? (
            <form onSubmit={onSubmitReply} className="space-y-2">
              {topicStatus !== "active" ? (
                <P5Alert role="status" variant="warn" title={t("dialogue.readOnlyTitle")}>
                  {t("dialogue.topicReadOnlyWithStatus", { status: t(`status.${topicStatus}`) })}
                </P5Alert>
              ) : null}

              <div className="space-y-1">
                <label className="font-mono text-xs font-semibold uppercase tracking-wide text-[color:var(--ink)]">
                  {t("dialogue.replyLabel")}
                </label>
                <div
                  className="overflow-hidden border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-ink)]"
                  style={{
                    clipPath:
                      "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-1 border-b-[3px] border-[color:var(--ink)] bg-[color:var(--concrete-200)] p-1 text-xs">
                    {(
                      [
                        {
                          label: t("editor.bold"),
                          onClick: () => replyEditor?.chain().focus().toggleBold().run(),
                        },
                        {
                          label: t("editor.italic"),
                          onClick: () => replyEditor?.chain().focus().toggleItalic().run(),
                        },
                        {
                          label: t("editor.underline"),
                          onClick: () => replyEditor?.chain().focus().toggleUnderline().run(),
                        },
                        {
                          label: t("editor.bulletList"),
                          onClick: () => replyEditor?.chain().focus().toggleBulletList().run(),
                        },
                        {
                          label: t("editor.orderedList"),
                          onClick: () => replyEditor?.chain().focus().toggleOrderedList().run(),
                        },
                        {
                          label: t("editor.quote"),
                          onClick: () => replyEditor?.chain().focus().toggleBlockquote().run(),
                        },
                      ] as const
                    ).map((tool) => (
                      <button
                        key={tool.label}
                        type="button"
                        onClick={tool.onClick}
                        disabled={!replyEditor || !canCreateArgument}
                        className="border-[2px] border-[color:var(--ink)] bg-[color:var(--paper)] px-2 py-1 font-semibold text-[color:var(--ink)] shadow-[2px_2px_0_var(--ink)] disabled:opacity-60"
                        style={{
                          clipPath:
                            "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
                        }}
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                  <div className={canCreateArgument ? "" : "opacity-60"}>
                    <EditorContent editor={replyEditor} />
                  </div>
                </div>
              </div>

              {ledger ? (
                <p className="text-xs text-[color:var(--ink)]/80">
                  {t("dialogue.balance")}: <span className="font-mono">{ledger.balance}</span>
                </p>
              ) : null}

              {replyError ? (
                <P5Alert role="alert" variant="error" title={t("common.error")}>
                  {replyError}
                </P5Alert>
              ) : null}

              {replyAutosave.kind !== "idle" ? (
                <p
                  className={[
                    "text-xs",
                    replyAutosave.kind === "error"
                      ? "text-[color:var(--rebel-red)]"
                      : "text-[color:var(--ink)]/60",
                  ].join(" ")}
                >
                  {replyAutosave.kind === "saving"
                    ? t("dialogue.autosaveSaving")
                    : replyAutosave.kind === "saved"
                      ? t("dialogue.autosaveSavedAt", {
                          time: formatSavedTime(replyAutosave.savedAt) ?? "",
                        }).trim()
                      : replyAutosave.message}
                </p>
              ) : null}

              <P5Button
                type="submit"
                variant="primary"
                disabled={!canPost || isSubmittingReply || !canCreateArgument}
              >
                {isSubmittingReply ? t("dialogue.posting") : t("dialogue.post")}
              </P5Button>
            </form>
          ) : (
            <P5Alert role="status" variant="info" title={t("dialogue.readOnlyTitle")}>
              {t("dialogue.noIdentityHint")}
            </P5Alert>
          )}

          {children.items.length === 0 ? (
            <p className="text-sm text-[color:var(--ink)]/80">{t("dialogue.noRepliesYet")}</p>
          ) : (
            <ul
              className="divide-y-[3px] divide-[color:var(--ink)] border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-ink)]"
              style={{
                clipPath:
                  "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
              }}
            >
              {children.items.map((item) => (
                <li key={item.id} className="p-3">
                  <p className="text-sm text-[color:var(--ink)]">{item.label}</p>
                  {canWrite ? (
                    <VoteControl
                      topicId={topicId}
                      argumentId={item.id}
                      topicStatus={topicStatus}
                      argumentPrunedAt={item.prunedAt}
                      onLedgerUpdated={onLedgerUpdated}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {children.hasMore ? (
            <P5Button
              type="button"
              onClick={children.loadMore}
              disabled={children.isLoadingMore}
              className="justify-center"
            >
              {t("common.loadMore")}
            </P5Button>
          ) : null}
        </div>
      ) : null}
    </P5Panel>
  );
}
