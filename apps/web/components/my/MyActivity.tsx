"use client";

/**
 * MyActivity - My Activity page component
 * Step 17: Pure client-side aggregation for visited topics
 *
 * @see docs/steps/step17.md
 * @see docs/core-flows.md#5
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BatchBalanceResult,
  StakeMeItem,
} from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { createLocalStorageVisitedTopicsStore } from "@/lib/visitedTopicsStore";
import {
  withdrawAll,
  type WithdrawProgress,
  type WithdrawResult,
} from "@/lib/withdrawAll";

type TopicBalance = {
  topicId: string;
  status: "loading" | "ok" | "error";
  balance?: number;
  myTotalVotes?: number;
  myTotalCost?: number;
  lastInteractionAt?: string | null;
  errorCode?: string;
  errorMessage?: string;
};

type TopicStakes = {
  status: "idle" | "loading" | "ok" | "error";
  items: StakeMeItem[];
  errorMessage?: string;
};

type WithdrawState = {
  status: "idle" | "withdrawing" | "done";
  progress?: WithdrawProgress;
  result?: WithdrawResult;
};

export function MyActivity() {
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const visitedStore = useMemo(() => createLocalStorageVisitedTopicsStore(), []);

  const [hasIdentity] = useState<boolean>(() => {
    try {
      return Boolean(keyStore.getMasterSeedHex());
    } catch {
      return false;
    }
  });
  const [topicBalances, setTopicBalances] = useState<TopicBalance[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [stakes, setStakes] = useState<TopicStakes>({ status: "idle", items: [] });
  const [withdrawState, setWithdrawState] = useState<WithdrawState>({ status: "idle" });

  // Load topic balances
  useEffect(() => {
    if (!hasIdentity) return;

    const topicIds = visitedStore.getTopicIds();
    if (topicIds.length === 0) {
      return;
    }

    let cancelled = false;

    (async () => {
      // Defer state updates to avoid synchronous setState inside effect
      await Promise.resolve();
      if (cancelled) return;

      setTopicBalances(
        topicIds.map((topicId) => ({
          topicId,
          status: "loading" as const,
        })),
      );

      const result = await apiClient.batchBalance(topicIds);

      if (cancelled) return;

      if (!result.ok) {
        // All failed
        setTopicBalances(
          topicIds.map((topicId) => ({
            topicId,
            status: "error" as const,
            errorMessage: result.error.message,
          })),
        );
        return;
      }

      // Map results to topic balances
      const balances: TopicBalance[] = result.data.results.map(
        (item: BatchBalanceResult) => {
          if (item.ok) {
            return {
              topicId: item.topicId,
              status: "ok" as const,
              balance: item.balance,
              myTotalVotes: item.myTotalVotes,
              myTotalCost: item.myTotalCost,
              lastInteractionAt: item.lastInteractionAt,
            };
          }
          return {
            topicId: item.topicId,
            status: "error" as const,
            errorCode: item.error.code,
            errorMessage: item.error.message,
          };
        },
      );

      setTopicBalances(balances);
    })();

    return () => {
      cancelled = true;
    };
  }, [hasIdentity, visitedStore]);

  // Load stakes for selected topic
  useEffect(() => {
    if (!selectedTopicId || !hasIdentity) return;

    let cancelled = false;

    (async () => {
      // Defer state updates to avoid synchronous setState inside effect
      await Promise.resolve();
      if (cancelled) return;

      setStakes({ status: "loading", items: [] });

      const result = await apiClient.getStakesMe(selectedTopicId);

      if (cancelled) return;

      if (!result.ok) {
        setStakes({
          status: "error",
          items: [],
          errorMessage: result.error.message,
        });
        return;
      }

      setStakes({ status: "ok", items: result.data.items });
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTopicId, hasIdentity]);

  const handleWithdrawAll = useCallback(async () => {
    if (!selectedTopicId || stakes.items.length === 0) return;

    setWithdrawState({ status: "withdrawing" });

    const stakesToWithdraw = stakes.items.map((s) => ({
      argumentId: s.argumentId,
      votes: s.votes,
      cost: s.cost,
    }));

    const result = await withdrawAll(selectedTopicId, stakesToWithdraw, {
      concurrencyLimit: 2,
      onProgress: (progress) => {
        setWithdrawState((prev) => ({
          ...prev,
          progress,
        }));
      },
    });

    setWithdrawState({ status: "done", result });

    // Update balance if we have a final ledger
    if (result.finalLedger) {
      setTopicBalances((prev) =>
        prev.map((tb) =>
          tb.topicId === selectedTopicId
            ? {
                ...tb,
                balance: result.finalLedger!.balance,
                myTotalVotes: result.finalLedger!.myTotalVotes,
                myTotalCost: result.finalLedger!.myTotalCost,
              }
            : tb,
        ),
      );
    }

    // Refresh stakes to show updated state
    const stakesResult = await apiClient.getStakesMe(selectedTopicId);
    if (stakesResult.ok) {
      setStakes({ status: "ok", items: stakesResult.data.items });
    }
  }, [selectedTopicId, stakes.items]);

  const handleRetryFailed = useCallback(async () => {
    if (!selectedTopicId || !withdrawState.result?.failed.length) return;

    setWithdrawState({ status: "withdrawing" });

    const stakesToRetry = withdrawState.result.failed.map((f) => ({
      argumentId: f.argumentId,
      votes: f.votes,
      cost: f.cost,
    }));

    const result = await withdrawAll(selectedTopicId, stakesToRetry, {
      concurrencyLimit: 2,
      onProgress: (progress) => {
        setWithdrawState((prev) => ({
          ...prev,
          progress,
        }));
      },
    });

    setWithdrawState({ status: "done", result });

    // Update balance if we have a final ledger
    if (result.finalLedger) {
      setTopicBalances((prev) =>
        prev.map((tb) =>
          tb.topicId === selectedTopicId
            ? {
                ...tb,
                balance: result.finalLedger!.balance,
                myTotalVotes: result.finalLedger!.myTotalVotes,
                myTotalCost: result.finalLedger!.myTotalCost,
              }
            : tb,
        ),
      );
    }
  }, [selectedTopicId, withdrawState.result]);

  if (!hasIdentity) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Please set up your identity first to view your activity.
      </div>
    );
  }

  const visitedTopicIds = visitedStore.getTopicIds();

  if (visitedTopicIds.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        No topics visited yet. Visit some topics to see your activity here.
      </div>
    );
  }

  const stakesWithVotes = stakes.items.filter((s) => s.votes > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My Activity</h1>

      {/* Topic List */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-700">Visited Topics</h2>
        <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200">
          {topicBalances.map((tb) => (
            <div
              key={tb.topicId}
              data-topic-row
              className={`cursor-pointer p-3 transition-colors hover:bg-zinc-50 ${
                selectedTopicId === tb.topicId ? "bg-zinc-100" : ""
              }`}
              onClick={() => {
                const nextSelectedTopicId =
                  selectedTopicId === tb.topicId ? null : tb.topicId;
                setSelectedTopicId(nextSelectedTopicId);
                setWithdrawState({ status: "idle" });
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{tb.topicId}</span>
                {tb.status === "loading" ? (
                  <span className="text-xs text-zinc-500">Loading...</span>
                ) : tb.status === "ok" ? (
                  <span className="text-sm">
                    Balance: <span className="font-mono">{tb.balance}</span>
                  </span>
                ) : (
                  <span className="text-xs text-red-600">
                    {tb.errorCode === "TOPIC_NOT_FOUND"
                      ? "Topic not found"
                      : tb.errorCode === "INVALID_SIGNATURE"
                        ? "Signature error"
                        : tb.errorMessage ?? "Error"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Topic Stakes */}
      {selectedTopicId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-700">
              Stakes in {selectedTopicId.slice(0, 8)}...
            </h2>
            {stakesWithVotes.length > 0 && withdrawState.status !== "withdrawing" && (
              <button
                type="button"
                onClick={handleWithdrawAll}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Withdraw All
              </button>
            )}
          </div>

          {/* Withdraw Progress */}
          {withdrawState.status === "withdrawing" && withdrawState.progress && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              Withdrawing... {withdrawState.progress.completed} /{" "}
              {withdrawState.progress.total}
            </div>
          )}

          {/* Withdraw Result */}
          {withdrawState.status === "done" && withdrawState.result && (
            <div className="space-y-2">
              {withdrawState.result.successful.length > 0 && (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                  Successfully withdrawn {withdrawState.result.successful.length}{" "}
                  stake(s)
                </div>
              )}
              {withdrawState.result.failed.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <p className="mb-2">
                    Failed to withdraw {withdrawState.result.failed.length} stake(s)
                  </p>
                  <button
                    type="button"
                    onClick={handleRetryFailed}
                    className="rounded-md bg-red-700 px-3 py-1 text-sm font-medium text-white hover:bg-red-600"
                  >
                    Retry Failed
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Stakes List */}
          {stakes.status === "loading" ? (
            <p className="text-sm text-zinc-500">Loading stakes...</p>
          ) : stakes.status === "error" ? (
            <p className="text-sm text-red-600">{stakes.errorMessage}</p>
          ) : stakes.items.length === 0 ? (
            <p className="text-sm text-zinc-500">No stakes in this topic</p>
          ) : (
            <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200">
              {stakes.items.map((stake) => (
                <div key={stake.argumentId} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {stake.argumentTitle ?? stake.argumentExcerpt ?? "Untitled"}
                      </p>
                      {stake.argumentExcerpt && stake.argumentTitle && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {stake.argumentExcerpt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {stake.argumentPrunedAt && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          Pruned
                        </span>
                      )}
                      <span>
                        Votes: <span className="font-mono">{stake.votes}</span>
                      </span>
                      <span className="text-zinc-400">
                        Cost: <span className="font-mono">{stake.cost}</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
