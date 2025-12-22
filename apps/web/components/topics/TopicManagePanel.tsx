"use client";

import { useMemo, useState, type FormEvent } from "react";

import type { TopicCommand } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { useP5Confirm } from "@/components/ui/P5ConfirmProvider";
import { P5Input } from "@/components/ui/P5Input";
import { P5Panel } from "@/components/ui/P5Panel";
import { P5Textarea } from "@/components/ui/P5Textarea";
import { useP5Toast } from "@/components/ui/P5ToastProvider";

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
  const { confirm } = useP5Confirm();
  const { toast } = useP5Toast();

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

    if (command.type === "SET_STATUS" && command.payload.status === "archived") {
      const ok = await confirm({
        title: "Archive topic",
        message: "This will make the topic permanently read-only.\n\nContinue?",
        confirmLabel: "Archive",
        variant: "danger",
      });
      if (!ok) return;
    }

    setIsSubmitting(true);
    const result = await apiClient.executeTopicCommand(topicId, command);
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      toast({ variant: "error", title: "host", message: result.error.message });
      return;
    }

    onInvalidate();
    toast({ variant: "success", title: "host", message: "Command applied." });
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
    <P5Panel
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            Host Deck
          </h2>
          <P5Button type="button" onClick={onClose} size="sm" className="shadow-none">
            Close
          </P5Button>
        </div>
      }
      bodyClassName="space-y-3"
    >
        <div className="space-y-2">
          <p className="text-sm text-[color:var(--ink)]">
            Status: <span className="font-mono">{topicStatus}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {statusActions.map((action) => (
              <P5Button
                key={action.label}
                type="button"
                disabled={isSubmitting || (topicStatus === "archived")}
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

        <form onSubmit={onSubmitEditRoot} className="space-y-2">
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
          <P5Button
            type="submit"
            disabled={!canManage || isSubmitting}
            variant="primary"
          >
            Save root
          </P5Button>
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
                Reason (optional)
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

        {submitError ? (
          <P5Alert role="alert" variant="error" title="error">
            {submitError}
          </P5Alert>
        ) : null}
    </P5Panel>
  );
}
