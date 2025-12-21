"use client";

import { useCallback, useEffect, useState } from "react";

import type { LedgerMe } from "@epiphany/shared-contracts";

import { FocusView } from "@/components/topics/FocusView";
import { DialogueStream } from "@/components/topics/DialogueStream";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";
import { useTopicSse } from "@/components/topics/hooks/useTopicSse";
import { apiClient } from "@/lib/apiClient";

type Props = {
  topicId: string;
};

export function TopicPage({ topicId }: Props) {
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

  const tree = useTopicTree(topicId, 3, refreshToken);
  const [selectedArgumentId, setSelectedArgumentId] = useState<string | null>(
    null,
  );
  const [ledger, setLedger] = useState<LedgerMe | null>(null);
  const [ledgerError, setLedgerError] = useState("");

  useEffect(() => {
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
  }, [topicId]);

  if (tree.status === "loading") {
    return <p className="text-sm text-zinc-600">Loading topic…</p>;
  }

  if (tree.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      >
        {tree.errorMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {reloadRequired ? (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Realtime stream is out of date. Please refresh.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-amber-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
            >
              Refresh
            </button>
          </div>
        </div>
      ) : null}
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{tree.topic.title}</h1>
        <p className="text-sm text-zinc-600">
          TopicId: <code className="font-mono">{tree.topic.id}</code>
        </p>
        {ledger ? (
          <p className="text-sm text-zinc-600">
            Balance: <span className="font-mono">{ledger.balance}</span>
          </p>
        ) : ledgerError ? (
          <p className="text-sm text-red-700">{ledgerError}</p>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.25fr]">
        <FocusView
          rootId={tree.topic.rootArgumentId}
          nodes={tree.nodes}
          selectedId={selectedArgumentId}
          onSelect={setSelectedArgumentId}
        />
        <DialogueStream
          topicId={topicId}
          parentArgumentId={selectedArgumentId}
          refreshToken={refreshToken}
          onInvalidate={invalidate}
          ledger={ledger}
          onLedgerUpdated={setLedger}
        />
      </div>
    </div>
  );
}
