"use client";

/**
 * MyActivity - My Activity page component
 * Step 17: Pure client-side aggregation for visited topics
 * Phase 4: Identity management with mnemonic backup
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
import {
  deriveTopicKeypairFromMasterSeedHex,
  mnemonicToMasterSeedHex,
} from "@/lib/identity";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Button, P5LinkButton } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { MnemonicDisplay } from "@/components/my/MnemonicDisplay";
import { ImportIdentityModal } from "@/components/my/ImportIdentityModal";

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
  const visitedStore = useMemo(
    () => createLocalStorageVisitedTopicsStore(),
    []
  );

  const [hasIdentity, setHasIdentity] = useState<boolean>(() => {
    try {
      return Boolean(keyStore.getMasterSeedHex());
    } catch {
      return false;
    }
  });
  const [topicBalances, setTopicBalances] = useState<TopicBalance[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [stakes, setStakes] = useState<TopicStakes>({
    status: "idle",
    items: [],
  });
  const [withdrawState, setWithdrawState] = useState<WithdrawState>({
    status: "idle",
  });
  const [isImportOpen, setIsImportOpen] = useState(false);

  // 获取助记词
  const mnemonic = useMemo(() => {
    try {
      return keyStore.getMnemonic() || null;
    } catch {
      return null;
    }
  }, [keyStore]);

  // 获取主身份地址
  const masterAddress = useMemo(() => {
    try {
      const seedHex = keyStore.getMasterSeedHex();
      if (!seedHex) return null;
      const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(
        seedHex,
        "master"
      );
      return `${pubkeyHex.slice(0, 8)}...${pubkeyHex.slice(-8)}`;
    } catch {
      return null;
    }
  }, [keyStore]);

  // 导入处理
  const handleImport = useCallback(
    (newMnemonic: string) => {
      try {
        const seedHex = mnemonicToMasterSeedHex(newMnemonic);
        keyStore.setMasterSeedHex(seedHex);
        keyStore.setMnemonic(newMnemonic);
        setHasIdentity(true);
        window.location.reload(); // 刷新以应用新身份
      } catch (e) {
        console.error("Import failed:", e);
      }
    },
    [keyStore]
  );

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
        }))
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
          }))
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
        }
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
            : tb
        )
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
            : tb
        )
      );
    }
  }, [selectedTopicId, withdrawState.result]);

  const visitedTopicIds = visitedStore.getTopicIds();
  const stakesWithVotes = stakes.items.filter((s) => s.votes > 0);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl uppercase tracking-wide text-[color:var(--ink)]">
        My Activity
      </h1>

      {/* 身份管理区域 */}
      <P5Panel
        header={
          <div className="bg-[color:var(--ink)] px-4 py-3 font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
            身份管理
          </div>
        }
      >
        <div className="space-y-6 p-4">
          {/* 当前身份 */}
          <div>
            <h3 className="mb-2 font-display text-sm uppercase tracking-wide text-[color:var(--ink)]">
              当前身份
            </h3>
            <div className="flex items-center gap-3 border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-3">
              {/* 指纹图标 */}
              <div className="flex gap-1">
                <span className="h-3 w-3 rounded-full bg-[color:var(--rebel-red)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--acid)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--electric)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--ink)]" />
              </div>
              <span className="font-mono text-sm">
                {masterAddress || "未设置"}
              </span>
            </div>
          </div>

          {/* 助记词 */}
          {mnemonic && <MnemonicDisplay mnemonic={mnemonic} />}

          {/* 导入按钮 */}
          <div className="border-t-[3px] border-[color:var(--concrete-200)] pt-4">
            <P5Button variant="ghost" onClick={() => setIsImportOpen(true)}>
              导入已有身份
            </P5Button>
            <p className="mt-2 text-sm text-[color:var(--ink)]/60">
              用于跨设备同步或恢复
            </p>
          </div>
        </div>
      </P5Panel>

      {/* 无身份提示 */}
      {!hasIdentity && (
        <P5Alert role="alert" variant="warn" title="identity">
          身份尚未初始化，请刷新页面或导入已有身份。
        </P5Alert>
      )}

      {/* 无访问记录 */}
      {hasIdentity && visitedTopicIds.length === 0 && (
        <P5Panel
          header={
            <div className="bg-[color:var(--ink)] px-4 py-3 font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
              已访问议题
            </div>
          }
        >
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 text-4xl text-[color:var(--ink)]/30">📭</div>
            <div className="font-display text-lg uppercase text-[color:var(--ink)]">
              暂无参与记录
            </div>
            <div className="mt-2 text-sm text-[color:var(--ink)]/70">
              去参与议题讨论吧
            </div>
            <P5LinkButton href="/" variant="primary" className="mt-4">
              浏览议题
            </P5LinkButton>
          </div>
        </P5Panel>
      )}

      {/* Topic List */}
      {hasIdentity && visitedTopicIds.length > 0 && (
        <P5Panel
          header={
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
              <h2 className="font-display text-sm uppercase tracking-wide">
                已访问议题
              </h2>
              <div className="text-xs text-white/80">本地聚合</div>
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
                  selectedTopicId === tb.topicId
                    ? "bg-[color:var(--ink)] text-[color:var(--paper)]"
                    : "",
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
                    <span className="text-xs opacity-80">加载中...</span>
                  ) : tb.status === "ok" ? (
                    <span className="text-sm">
                      余额: <span className="font-mono">{tb.balance}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-[color:var(--rebel-red)]">
                      {tb.errorCode === "TOPIC_NOT_FOUND"
                        ? "议题不存在"
                        : tb.errorCode === "INVALID_SIGNATURE"
                          ? "签名错误"
                          : tb.errorMessage ?? "错误"}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </P5Panel>
      )}

      {/* Selected Topic Stakes */}
      {selectedTopicId && (
        <P5Panel
          header={
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
              <h2 className="font-display text-sm uppercase tracking-wide">
                投票于 {selectedTopicId.slice(0, 8)}...
              </h2>
              {stakesWithVotes.length > 0 &&
              withdrawState.status !== "withdrawing" ? (
                <P5Button
                  type="button"
                  onClick={handleWithdrawAll}
                  variant="primary"
                  size="sm"
                >
                  全部撤回
                </P5Button>
              ) : null}
            </div>
          }
          bodyClassName="space-y-4"
        >
          {/* Withdraw Progress */}
          {withdrawState.status === "withdrawing" && withdrawState.progress && (
            <P5Alert role="status" variant="info" title="withdrawing">
              撤回中... {withdrawState.progress.completed} /{" "}
              {withdrawState.progress.total}
            </P5Alert>
          )}

          {/* Withdraw Result */}
          {withdrawState.status === "done" && withdrawState.result && (
            <div className="space-y-2">
              {withdrawState.result.successful.length > 0 && (
                <P5Alert role="status" variant="info" title="success">
                  成功撤回 {withdrawState.result.successful.length} 个投票
                </P5Alert>
              )}
              {withdrawState.result.failed.length > 0 && (
                <P5Alert role="alert" variant="error" title="failed">
                  <p className="mb-2">
                    {withdrawState.result.failed.length} 个投票撤回失败
                  </p>
                  <P5Button
                    type="button"
                    onClick={handleRetryFailed}
                    variant="danger"
                    size="sm"
                  >
                    重试失败项
                  </P5Button>
                </P5Alert>
              )}
            </div>
          )}

          {/* Stakes List */}
          {stakes.status === "loading" ? (
            <p className="p-4 text-sm text-[color:var(--ink)]/80">
              加载投票记录...
            </p>
          ) : stakes.status === "error" ? (
            <p className="p-4 text-sm text-[color:var(--rebel-red)]">
              {stakes.errorMessage}
            </p>
          ) : stakes.items.length === 0 ? (
            <p className="p-4 text-sm text-[color:var(--ink)]/80">
              此议题暂无投票记录
            </p>
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
                        {stake.argumentTitle ??
                          stake.argumentExcerpt ??
                          "无标题"}
                      </p>
                      {stake.argumentExcerpt && stake.argumentTitle && (
                        <p className="mt-0.5 truncate text-xs text-[color:var(--ink)]/70">
                          {stake.argumentExcerpt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {stake.argumentPrunedAt && (
                        <P5Badge variant="acid">已修剪</P5Badge>
                      )}
                      <span>
                        票数: <span className="font-mono">{stake.votes}</span>
                      </span>
                      <span className="text-[color:var(--ink)]/70">
                        花费: <span className="font-mono">{stake.cost}</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </P5Panel>
      )}

      {/* 导入 Modal */}
      <ImportIdentityModal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={handleImport}
      />
    </div>
  );
}
