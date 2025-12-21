"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { LedgerMe } from "@epiphany/shared-contracts";

import { useChildren, type ChildrenOrderBy } from "@/components/topics/hooks/useChildren";
import { apiClient, type ApiError } from "@/lib/apiClient";

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
        className="text-xs font-medium text-zinc-700"
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
        <p className="text-xs text-zinc-500">
          {props.argumentPrunedAt
            ? "This node is pruned: you can only withdraw."
            : "Topic is read-only: you can only withdraw."}
        </p>
      ) : null}
      <p className="text-xs text-zinc-600">
        Cost: {targetCost} (ΔCost: {formatDelta(deltaCost)})
      </p>

      {submitError ? (
        <p role="alert" className="text-xs text-red-700">
          {submitError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submitVotes}
        disabled={disableSubmit}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Save"}
      </button>
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
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  useEffect(() => {
    setOrderBy("totalVotes_desc");
    setReplyBody("");
    setReplyError("");
  }, [parentArgumentId]);

  const children = useChildren({
    parentArgumentId,
    orderBy,
    limit: 30,
    refreshToken,
  });

  const canPost = useMemo(
    () => Boolean(parentArgumentId && replyBody.trim()),
    [parentArgumentId, replyBody],
  );
  const canCreateArgument = canWrite && topicStatus === "active";

  async function onSubmitReply(event: FormEvent) {
    event.preventDefault();
    if (!parentArgumentId) return;
    if (!canCreateArgument) return;
    setReplyError("");

    const body = replyBody.trim();
    if (!body) {
      setReplyError("Reply is required");
      return;
    }

    setIsSubmittingReply(true);
    const result = await apiClient.createArgument(topicId, {
      parentId: parentArgumentId,
      title: null,
      body,
      initialVotes: 0,
    });
    setIsSubmittingReply(false);

    if (!result.ok) {
      setReplyError(toFriendlyMessage(result.error));
      setReplyBody("");
      return;
    }

    onLedgerUpdated(result.data.ledger);
    children.prependItem({
      id: result.data.argument.id,
      label: toLabel(result.data.argument),
      prunedAt: result.data.argument.prunedAt,
    });
    setReplyBody("");
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-700">Dialogue</h2>

        {parentArgumentId ? (
          <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setOrderBy("totalVotes_desc")}
              aria-pressed={orderBy === "totalVotes_desc"}
              className={[
                "rounded-md px-2 py-1",
                orderBy === "totalVotes_desc"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100",
              ].join(" ")}
            >
              最热
            </button>
            <button
              type="button"
              onClick={() => setOrderBy("createdAt_desc")}
              aria-pressed={orderBy === "createdAt_desc"}
              className={[
                "rounded-md px-2 py-1",
                orderBy === "createdAt_desc"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100",
              ].join(" ")}
            >
              最新
            </button>
          </div>
        ) : null}
      </div>

      {!parentArgumentId ? (
        <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Select a node to view replies.
        </div>
      ) : null}

      {parentArgumentId && children.status === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {children.errorMessage}
        </div>
      ) : null}

      {parentArgumentId && children.status === "loading" ? (
        <p className="text-sm text-zinc-600">
          Loading {toToggleLabel(orderBy)}…
        </p>
      ) : null}

      {parentArgumentId && children.status === "success" ? (
        <div className="space-y-3">
          {canWrite ? (
            <form onSubmit={onSubmitReply} className="space-y-2">
              {topicStatus !== "active" ? (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  Topic is read-only ({topicStatus}). You can still withdraw votes.
                </div>
              ) : null}
              <div className="space-y-1">
                <label
                  htmlFor="reply"
                  className="text-sm font-medium text-zinc-700"
                >
                  Reply
                </label>
                <textarea
                  id="reply"
                  name="reply"
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  rows={3}
                  disabled={!canCreateArgument}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              {ledger ? (
                <p className="text-xs text-zinc-600">
                  Balance: <span className="font-mono">{ledger.balance}</span>
                </p>
              ) : null}

              {replyError ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  {replyError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!canPost || isSubmittingReply || !canCreateArgument}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isSubmittingReply ? "Posting…" : "Post"}
              </button>
            </form>
          ) : (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              Read-only mode. Set up your identity to reply or vote.
            </div>
          )}

          {children.items.length === 0 ? (
            <p className="text-sm text-zinc-600">No replies yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
              {children.items.map((item) => (
                <li key={item.id} className="p-3">
                  <p className="text-sm text-zinc-800">{item.label}</p>
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
            <button
              type="button"
              onClick={children.loadMore}
              disabled={children.isLoadingMore}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
            >
              加载更多
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
