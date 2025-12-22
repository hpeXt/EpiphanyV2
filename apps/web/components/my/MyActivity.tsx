"use client";

/**
 * MyActivity - My Activity page component
 * Step 17: Pure client-side aggregation for visited topics
 *
 * @see docs/stage01/steps/step17.md
 * @see docs/stage01/core-flows.md#5
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
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";

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
      <P5Alert role="alert" variant="warn" title="identity">
        Please set up your identity first to view your activity.
      </P5Alert>
    );
  }

  const visitedTopicIds = visitedStore.getTopicIds();

  if (visitedTopicIds.length === 0) {
    return (
      <P5Alert role="status" variant="info" title="my activity">
        No topics visited yet. Visit some topics to see your activity here.
      </P5Alert>
    );
  }

  const stakesWithVotes = stakes.items.filter((s) => s.votes > 0);

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-xl font-semibold uppercase tracking-wide text-[color:var(--ink)]">
        My Activity
      </h1>

      {/* Topic List */}
      <P5Panel
        header={
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
              Visited Topics
            </h2>
            <div className="text-xs text-white/80">Local-only aggregation</div>
          </div>
        }
        bodyClassName="space-y-2"
      >
        <div
          className="divide-y-[3px] divide-[color:var(--ink)] border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-ink)]"
          style={{
            clipPath:
              "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
          }}
        >
          {topicBalances.map((tb) => (
            <button
              key={tb.topicId}
              data-topic-row
              type="button"
              className={[
                "w-full p-3 text-left transition-colors",
                "hover:bg-[color:var(--concrete-200)]",
                selectedTopicId === tb.topicId ? "bg-[color:var(--ink)] text-[color:var(--paper)]" : "",
              ].join(" ")}
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
                  <span className="text-xs opacity-80">Loading...</span>
                ) : tb.status === "ok" ? (
                  <span className="text-sm">
                    Balance: <span className="font-mono">{tb.balance}</span>
                  </span>
                ) : (
                  <span className="text-xs text-[color:var(--rebel-red)]">
                    {tb.errorCode === "TOPIC_NOT_FOUND"
                      ? "Topic not found"
                      : tb.errorCode === "INVALID_SIGNATURE"
                        ? "Signature error"
                        : tb.errorMessage ?? "Error"}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </P5Panel>

      {/* Selected Topic Stakes */}
      {selectedTopicId && (
        <P5Panel
          header={
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
              <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
                Stakes in {selectedTopicId.slice(0, 8)}...
              </h2>
              {stakesWithVotes.length > 0 && withdrawState.status !== "withdrawing" ? (
                <P5Button type="button" onClick={handleWithdrawAll} variant="primary" size="sm">
                  Withdraw All
                </P5Button>
              ) : null}
            </div>
          }
          bodyClassName="space-y-4"
        >

          {/* Withdraw Progress */}
          {withdrawState.status === "withdrawing" && withdrawState.progress && (
            <P5Alert role="status" variant="info" title="withdrawing">
              Withdrawing... {withdrawState.progress.completed} /{" "}
              {withdrawState.progress.total}
            </P5Alert>
          )}

          {/* Withdraw Result */}
          {withdrawState.status === "done" && withdrawState.result && (
            <div className="space-y-2">
              {withdrawState.result.successful.length > 0 && (
                <P5Alert role="status" variant="info" title="success">
                  Successfully withdrawn {withdrawState.result.successful.length}{" "}
                  stake(s)
                </P5Alert>
              )}
              {withdrawState.result.failed.length > 0 && (
                <P5Alert role="alert" variant="error" title="failed">
                  <p className="mb-2">
                    Failed to withdraw {withdrawState.result.failed.length} stake(s)
                  </p>
                  <P5Button
                    type="button"
                    onClick={handleRetryFailed}
                    variant="danger"
                    size="sm"
                  >
                    Retry Failed
                  </P5Button>
                </P5Alert>
              )}
            </div>
          )}

          {/* Stakes List */}
          {stakes.status === "loading" ? (
            <p className="text-sm text-[color:var(--ink)]/80">Loading stakes...</p>
          ) : stakes.status === "error" ? (
            <p className="text-sm text-[color:var(--rebel-red)]">{stakes.errorMessage}</p>
          ) : stakes.items.length === 0 ? (
            <p className="text-sm text-[color:var(--ink)]/80">No stakes in this topic</p>
          ) : (
            <div
              className="divide-y-[3px] divide-[color:var(--ink)] border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-ink)]"
              style={{
                clipPath:
                  "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
              }}
            >
              {stakes.items.map((stake) => (
                <div key={stake.argumentId} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {stake.argumentTitle ?? stake.argumentExcerpt ?? "Untitled"}
                      </p>
                      {stake.argumentExcerpt && stake.argumentTitle && (
                        <p className="mt-0.5 truncate text-xs text-[color:var(--ink)]/70">
                          {stake.argumentExcerpt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {stake.argumentPrunedAt && (
                        <P5Badge variant="acid">Pruned</P5Badge>
                      )}
                      <span>
                        Votes: <span className="font-mono">{stake.votes}</span>
                      </span>
                      <span className="text-[color:var(--ink)]/70">
                        Cost: <span className="font-mono">{stake.cost}</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </P5Panel>
      )}
    </div>
  );
}
