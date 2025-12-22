"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { zTiptapDoc, type LedgerMe } from "@epiphany/shared-contracts";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { useChildren, type ChildrenOrderBy } from "@/components/topics/hooks/useChildren";
import { apiClient, type ApiError } from "@/lib/apiClient";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { P5Tabs } from "@/components/ui/P5Tabs";

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

function toToggleLabel(orderBy: ChildrenOrderBy) {
  return orderBy === "totalVotes_desc" ? "最热" : "最新";
}

function toLabel(input: { title: string | null; body: string; id: string }): string {
  if (input.title) return input.title;
  const trimmed = input.body.trim();
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return input.id;
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

function VoteControl(props: {
  topicId: string;
  argumentId: string;
  topicStatus: "active" | "frozen" | "archived";
  argumentPrunedAt: string | null;
  onLedgerUpdated: (ledger: LedgerMe) => void;
}) {
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
      setSubmitError(toFriendlyMessage(result.error));
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
        Votes
      </label>
      <input
        id={`votes-${props.argumentId}`}
        aria-label="Votes"
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
            ? "This node is pruned: you can only withdraw."
            : "Topic is read-only: you can only withdraw."}
        </p>
      ) : null}
      <p className="text-xs text-[color:var(--ink)]/80">
        Cost: {targetCost} (ΔCost: {formatDelta(deltaCost)})
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
        {isSubmitting ? "Saving…" : "Save"}
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
  const [orderBy, setOrderBy] = useState<ChildrenOrderBy>("totalVotes_desc");
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

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
        "aria-label": "Reply",
        class: [
          "min-h-[96px] w-full px-3 py-2 text-sm text-zinc-900 outline-none",
          "prose prose-sm max-w-none",
        ].join(" "),
      },
    },
    onUpdate: ({ editor }) => {
      setReplyText(editor.getText());
    },
  });

  useEffect(() => {
    replyEditor?.setEditable(canCreateArgument);
  }, [replyEditor, canCreateArgument]);

  useEffect(() => {
    setOrderBy("totalVotes_desc");
    setReplyText("");
    setReplyError("");
    replyEditor?.commands.clearContent(true);
  }, [parentArgumentId, replyEditor]);

  const children = useChildren({
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
    setReplyError("");

    const body = replyText.trim();
    if (!body) {
      setReplyError("Reply is required");
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
      setReplyError(toFriendlyMessage(result.error));
      replyEditor?.commands.clearContent(true);
      setReplyText("");
      return;
    }

    onLedgerUpdated(result.data.ledger);
    children.prependItem({
      id: result.data.argument.id,
      label: toLabel(result.data.argument),
      prunedAt: result.data.argument.prunedAt,
    });
    replyEditor?.commands.clearContent(true);
    setReplyText("");
  }

  return (
    <P5Panel
      bodyClassName="space-y-3"
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            Dialogue
          </h2>

          {parentArgumentId ? (
            <P5Tabs
              ariaLabel="Dialogue order"
              value={orderBy}
              onValueChange={setOrderBy}
              tabs={[
                { value: "totalVotes_desc", label: "最热" },
                { value: "createdAt_desc", label: "最新" },
              ]}
              className="shadow-none"
            />
          ) : null}
        </div>
      }
    >
      {!parentArgumentId ? (
        <P5Alert role="status" variant="info" title="dialogue">
          Select a node to view replies.
        </P5Alert>
      ) : null}

      {parentArgumentId && children.status === "error" ? (
        <P5Alert role="alert" variant="error" title="error">
          {children.errorMessage}
        </P5Alert>
      ) : null}

      {parentArgumentId && children.status === "loading" ? (
        <p className="text-sm text-[color:var(--ink)]/80">
          Loading {toToggleLabel(orderBy)}…
        </p>
      ) : null}

      {parentArgumentId && children.status === "success" ? (
        <div className="space-y-3">
          {canWrite ? (
            <form onSubmit={onSubmitReply} className="space-y-2">
              {topicStatus !== "active" ? (
                <P5Alert role="status" variant="warn" title="read-only">
                  Topic is read-only ({topicStatus}). You can still withdraw votes.
                </P5Alert>
              ) : null}

              <div className="space-y-1">
                <label className="font-mono text-xs font-semibold uppercase tracking-wide text-[color:var(--ink)]">
                  Reply
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
                          label: "Bold",
                          onClick: () => replyEditor?.chain().focus().toggleBold().run(),
                        },
                        {
                          label: "Italic",
                          onClick: () => replyEditor?.chain().focus().toggleItalic().run(),
                        },
                        {
                          label: "Underline",
                          onClick: () => replyEditor?.chain().focus().toggleUnderline().run(),
                        },
                        {
                          label: "• List",
                          onClick: () => replyEditor?.chain().focus().toggleBulletList().run(),
                        },
                        {
                          label: "1. List",
                          onClick: () => replyEditor?.chain().focus().toggleOrderedList().run(),
                        },
                        {
                          label: "Quote",
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
                  Balance: <span className="font-mono">{ledger.balance}</span>
                </p>
              ) : null}

              {replyError ? (
                <P5Alert role="alert" variant="error" title="error">
                  {replyError}
                </P5Alert>
              ) : null}

              <P5Button
                type="submit"
                variant="primary"
                disabled={!canPost || isSubmittingReply || !canCreateArgument}
              >
                {isSubmittingReply ? "Posting…" : "Post"}
              </P5Button>
            </form>
          ) : (
            <P5Alert role="status" variant="info" title="read-only">
              Read-only mode. Set up your identity to reply or vote.
            </P5Alert>
          )}

          {children.items.length === 0 ? (
            <p className="text-sm text-[color:var(--ink)]/80">No replies yet.</p>
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
              加载更多
            </P5Button>
          ) : null}
        </div>
      ) : null}
    </P5Panel>
  );
}
