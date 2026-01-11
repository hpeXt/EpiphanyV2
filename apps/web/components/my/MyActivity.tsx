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
  mnemonicToMasterSeedHex,
} from "@/lib/identity";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Button, P5LinkButton } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { MnemonicDisplay } from "@/components/my/MnemonicDisplay";
import { ImportIdentityModal } from "@/components/my/ImportIdentityModal";
import { useI18n } from "@/components/i18n/I18nProvider";

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

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function MyActivity() {
  const { t } = useI18n();
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const visitedStore = useMemo(
    () => createLocalStorageVisitedTopicsStore(),
    []
  );

  const [hasIdentity, setHasIdentity] = useState(false);
  const [identityLoaded, setIdentityLoaded] = useState(false);
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

  const [mnemonic, setMnemonic] = useState<string | null>(null);

  useEffect(() => {
    try {
      const seedHex = keyStore.getMasterSeedHex();
      setHasIdentity(Boolean(seedHex));
      setMnemonic(keyStore.getMnemonic() || null);
    } catch {
      setHasIdentity(false);
      setMnemonic(null);
    } finally {
      setIdentityLoaded(true);
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

  const visitedTopicIds = useMemo(() => {
    if (!identityLoaded || !hasIdentity) return [];
    try {
      return visitedStore.getTopicIds();
    } catch {
      return [];
    }
  }, [hasIdentity, identityLoaded, visitedStore]);
  const stakesWithVotes = stakes.items.filter((s) => s.votes > 0);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl uppercase tracking-wide text-[color:var(--ink)]">
        {t("my.title")}
      </h1>

      {/* 身份管理区域 */}
      <P5Panel
        header={
          <div className="bg-[color:var(--ink)] px-4 py-3 font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
            {t("my.identitySectionTitle")}
          </div>
        }
      >
        <div className="space-y-6 p-4">
          {/* 当前身份 */}
          <div>
            <h3 className="mb-2 font-display text-sm uppercase tracking-wide text-[color:var(--ink)]">
              {t("my.currentIdentity")}
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
                {identityLoaded
                  ? hasIdentity
                    ? t("my.identityReady")
                    : t("my.identityNotSet")
                  : t("common.loading")}
              </span>
            </div>
          </div>

          {/* 助记词 */}
          {mnemonic && <MnemonicDisplay mnemonic={mnemonic} />}

          {/* 导入按钮 */}
          <div className="border-t-[3px] border-[color:var(--concrete-200)] pt-4">
            <P5Button variant="ghost" onClick={() => setIsImportOpen(true)}>
              {t("my.importIdentity")}
            </P5Button>
            <p className="mt-2 text-sm text-[color:var(--ink)]/60">
              {t("my.importHint")}
            </p>
          </div>
        </div>
      </P5Panel>

      {/* 无身份提示 */}
      {identityLoaded && !hasIdentity && (
        <P5Alert role="alert" variant="warn" title={t("my.identityAlertTitle")}>
          {t("my.identityAlertBody")}
        </P5Alert>
      )}

      {/* 无访问记录 */}
      {identityLoaded && hasIdentity && visitedTopicIds.length === 0 && (
        <P5Panel
          header={
            <div className="bg-[color:var(--ink)] px-4 py-3 font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
              {t("my.visitedTopicsTitle")}
            </div>
          }
        >
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 text-4xl text-[color:var(--ink)]/30">📭</div>
            <div className="font-display text-lg uppercase text-[color:var(--ink)]">
              {t("my.noHistoryTitle")}
            </div>
            <div className="mt-2 text-sm text-[color:var(--ink)]/70">
              {t("my.noHistoryBody")}
            </div>
            <P5LinkButton href="/" variant="primary" className="mt-4">
              {t("my.browseTopics")}
            </P5LinkButton>
          </div>
        </P5Panel>
      )}

      {/* Topic List */}
      {identityLoaded && hasIdentity && visitedTopicIds.length > 0 && (
        <P5Panel
          header={
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
              <h2 className="font-display text-sm uppercase tracking-wide">
                {t("my.visitedTopicsTitle")}
              </h2>
              <div className="text-xs text-white/80">{t("my.localAggregate")}</div>
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
                  <span className="font-mono text-sm">{shortId(tb.topicId)}</span>
                  {tb.status === "loading" ? (
                    <span className="text-xs opacity-80">{t("common.loadingDots")}</span>
                  ) : tb.status === "ok" ? (
                    <span className="text-sm">
                      {t("dialogue.balance")}: <span className="font-mono">{tb.balance}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-[color:var(--rebel-red)]">
                      {tb.errorCode === "TOPIC_NOT_FOUND"
                        ? t("my.topicNotFound")
                        : tb.errorCode === "INVALID_SIGNATURE"
                          ? t("my.signatureError")
                          : tb.errorMessage ?? t("common.error")}
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
                {t("my.stakesTitle", { topic: shortId(selectedTopicId) })}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <P5LinkButton
                  href={`/topics/${selectedTopicId}`}
                  variant="ghost"
                  size="sm"
                  className="border border-white/60 text-white shadow-none hover:bg-white/10"
                >
                  {t("my.openTopic")}
                </P5LinkButton>
                <P5LinkButton
                  href={`/topics/${selectedTopicId}?manage=1`}
                  variant="ghost"
                  size="sm"
                  className="border border-white/60 text-white shadow-none hover:bg-white/10"
                >
                  {t("my.hostManage")}
                </P5LinkButton>
                {stakesWithVotes.length > 0 && withdrawState.status !== "withdrawing" ? (
                  <P5Button
                    type="button"
                    onClick={handleWithdrawAll}
                    variant="primary"
                    size="sm"
                  >
                    {t("my.withdrawAll")}
                  </P5Button>
                ) : null}
              </div>
            </div>
          }
          bodyClassName="space-y-4"
        >
          {/* Withdraw Progress */}
          {withdrawState.status === "withdrawing" && withdrawState.progress && (
            <P5Alert role="status" variant="info" title={t("my.withdrawingTitle")}>
              {t("my.withdrawingProgress", {
                completed: withdrawState.progress.completed,
                total: withdrawState.progress.total,
              })}
            </P5Alert>
          )}

          {/* Withdraw Result */}
          {withdrawState.status === "done" && withdrawState.result && (
            <div className="space-y-2">
              {withdrawState.result.successful.length > 0 && (
                <P5Alert role="status" variant="info" title={t("toast.success")}>
                  {t("my.withdrawSuccess", { count: withdrawState.result.successful.length })}
                </P5Alert>
              )}
              {withdrawState.result.failed.length > 0 && (
                <P5Alert role="alert" variant="error" title={t("my.withdrawFailedTitle")}>
                  <p className="mb-2">
                    {t("my.withdrawFailed", { count: withdrawState.result.failed.length })}
                  </p>
                  <P5Button
                    type="button"
                    onClick={handleRetryFailed}
                    variant="danger"
                    size="sm"
                  >
                    {t("my.retryFailed")}
                  </P5Button>
                </P5Alert>
              )}
            </div>
          )}

          {/* Stakes List */}
          {stakes.status === "loading" ? (
            <p className="p-4 text-sm text-[color:var(--ink)]/80">
              {t("my.stakesLoading")}
            </p>
          ) : stakes.status === "error" ? (
            <p className="p-4 text-sm text-[color:var(--rebel-red)]">
              {stakes.errorMessage}
            </p>
          ) : stakes.items.length === 0 ? (
            <p className="p-4 text-sm text-[color:var(--ink)]/80">
              {t("my.stakesEmpty")}
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
                          t("my.untitled")}
                      </p>
                      {stake.argumentExcerpt && stake.argumentTitle && (
                        <p className="mt-0.5 truncate text-xs text-[color:var(--ink)]/70">
                          {stake.argumentExcerpt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {stake.argumentPrunedAt && (
                        <P5Badge variant="acid">{t("my.pruned")}</P5Badge>
                      )}
                      <span>
                        {t("my.votesLabel")}: <span className="font-mono">{stake.votes}</span>
                      </span>
                      <span className="text-[color:var(--ink)]/70">
                        {t("my.costLabel")}: <span className="font-mono">{stake.cost}</span>
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
