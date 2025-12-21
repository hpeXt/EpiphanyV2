"use client";

import { useMemo, useState, type FormEvent } from "react";

import type { TopicCommand } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";

type Props = {
  topicId: string;
  topicTitle: string;
  topicStatus: "active" | "frozen" | "archived";
  rootBody: string;
  onInvalidate: () => void;
  onClose: () => void;
};

export function TopicManagePanel({
  topicId,
  topicTitle,
  topicStatus,
  rootBody,
  onInvalidate,
  onClose,
}: Props) {
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [nextTitle, setNextTitle] = useState(topicTitle);
  const [nextBody, setNextBody] = useState(rootBody);

  const [pruneArgumentId, setPruneArgumentId] = useState("");
  const [pruneReason, setPruneReason] = useState("");

  const canManage = topicStatus === "active";
  const canUnfreeze = topicStatus === "frozen";

  const statusActions = useMemo(() => {
    if (topicStatus === "active") {
      return [
        { label: "Freeze", command: { type: "SET_STATUS", payload: { status: "frozen" } } as const },
        { label: "Archive", command: { type: "SET_STATUS", payload: { status: "archived" } } as const },
      ];
    }
    if (topicStatus === "frozen") {
      return [
        { label: "Unfreeze", command: { type: "SET_STATUS", payload: { status: "active" } } as const },
      ];
    }
    return [];
  }, [topicStatus]);

  async function runCommand(command: TopicCommand) {
    setSubmitError("");
    setIsSubmitting(true);
    const result = await apiClient.executeTopicCommand(topicId, command);
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }

    onInvalidate();
  }

  async function onSubmitEditRoot(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;

    await runCommand({
      type: "EDIT_ROOT",
      payload: { title: nextTitle, body: nextBody },
    });
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-700">Manage topic</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
        >
          Close
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div className="space-y-2">
          <p className="text-sm text-zinc-700">
            Status: <span className="font-mono">{topicStatus}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {statusActions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={isSubmitting || (topicStatus === "archived")}
                onClick={() => runCommand(action.command)}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
              >
                {action.label}
              </button>
            ))}
            {topicStatus === "archived" ? (
              <span className="text-sm text-zinc-500">
                Archived topics are read-only.
              </span>
            ) : null}
          </div>
          {canUnfreeze ? (
            <p className="text-sm text-zinc-600">
              Frozen topics only allow unfreeze.
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmitEditRoot} className="space-y-2">
          <div className="space-y-1">
            <label htmlFor="root-title" className="text-sm font-medium text-zinc-700">
              Root title
            </label>
            <input
              id="root-title"
              value={nextTitle}
              onChange={(event) => setNextTitle(event.target.value)}
              disabled={!canManage || isSubmitting}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="root-body" className="text-sm font-medium text-zinc-700">
              Root body
            </label>
            <textarea
              id="root-body"
              value={nextBody}
              onChange={(event) => setNextBody(event.target.value)}
              disabled={!canManage || isSubmitting}
              rows={4}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={!canManage || isSubmitting}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Save root
          </button>
        </form>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-700">Pruning</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="prune-argument-id" className="text-sm font-medium text-zinc-700">
                Argument ID
              </label>
              <input
                id="prune-argument-id"
                value={pruneArgumentId}
                onChange={(event) => setPruneArgumentId(event.target.value)}
                disabled={!canManage || isSubmitting}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="prune-reason" className="text-sm font-medium text-zinc-700">
                Reason (optional)
              </label>
              <input
                id="prune-reason"
                value={pruneReason}
                onChange={(event) => setPruneReason(event.target.value)}
                disabled={!canManage || isSubmitting}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canManage || isSubmitting || !pruneArgumentId.trim()}
              onClick={() =>
                runCommand({
                  type: "PRUNE_ARGUMENT",
                  payload: {
                    argumentId: pruneArgumentId.trim(),
                    reason: pruneReason.trim() ? pruneReason.trim() : null,
                  },
                })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
            >
              Prune
            </button>
            <button
              type="button"
              disabled={!canManage || isSubmitting || !pruneArgumentId.trim()}
              onClick={() =>
                runCommand({
                  type: "UNPRUNE_ARGUMENT",
                  payload: { argumentId: pruneArgumentId.trim() },
                })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
            >
              Unprune
            </button>
          </div>
        </div>

        {submitError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {submitError}
          </div>
        ) : null}
      </div>
    </section>
  );
}

