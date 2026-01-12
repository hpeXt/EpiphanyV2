"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { LedgerMe, Argument } from "@epiphany/shared-contracts";

import { IdentityOnboarding } from "@/components/identity/IdentityOnboarding";
import { FocusView } from "@/components/topics/FocusView";
import { GodView } from "@/components/topics/GodView";
import { SunburstView } from "@/components/topics/SunburstView";
import { DialogueStream } from "@/components/topics/DialogueStream";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";
import { useTopicSse } from "@/components/topics/hooks/useTopicSse";
import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
import { apiClient } from "@/lib/apiClient";
import { createLocalStorageClaimTokenStore } from "@/lib/claimTokenStore";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { TopicManagePanel } from "@/components/topics/TopicManagePanel";
import { createLocalStorageVisitedTopicsStore } from "@/lib/visitedTopicsStore";
import { ConsensusReportModal } from "@/components/topics/ConsensusReportModal";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Tabs } from "@/components/ui/P5Tabs";
import { useP5Toast } from "@/components/ui/P5ToastProvider";
import { P5SkeletonList } from "@/components/ui/P5Skeleton";
import { TopicDualColumn } from "@/components/topics/TopicDualColumn";
import { TopicTopBar } from "@/components/topics/TopicTopBar";
import { SelectedNodeCard } from "@/components/topics/SelectedNodeCard";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  topicId: string;
};

export function TopicPage({ topicId }: Props) {
  const { t } = useI18n();
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const visitedStore = useMemo(() => createLocalStorageVisitedTopicsStore(), []);
  const claimTokenStore = useMemo(() => createLocalStorageClaimTokenStore(), []);
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);
  const [identityFingerprint, setIdentityFingerprint] = useState<string | null>(null);
  const [identityPubkeyHex, setIdentityPubkeyHex] = useState<string | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);
  const { toast } = useP5Toast();

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
    null
  );
  const [viewMode, setViewMode] = useState<"focus" | "god" | "sunburst">("focus");
  const [ledger, setLedger] = useState<LedgerMe | null>(null);
  const [ledgerError, setLedgerError] = useState("");

  const rootArgumentId = tree.status === "success" ? tree.topic.rootArgumentId : null;
  const resolvedSelectedArgumentId = selectedArgumentId ?? rootArgumentId;

  // 获取选中节点
  const selectedNode = useMemo((): Argument | null => {
    if (!resolvedSelectedArgumentId || tree.status !== "success") return null;
    return tree.arguments.find((n) => n.id === resolvedSelectedArgumentId) || null;
  }, [resolvedSelectedArgumentId, tree]);

  useEffect(() => {
    try {
      setHasIdentity(Boolean(keyStore.getMasterSeedHex()));
    } catch {
      setHasIdentity(false);
    }
  }, [keyStore]);

  // Record this topic as visited (Step 17: My Activity aggregation)
  useEffect(() => {
    visitedStore.addTopic(topicId);
  }, [topicId, visitedStore]);

  useEffect(() => {
    if (!hasIdentity) {
      setIdentityFingerprint(null);
      setIdentityPubkeyHex(null);
      return;
    }

    const masterSeedHex = keyStore.getMasterSeedHex();
    if (!masterSeedHex) {
      setIdentityFingerprint(null);
      setIdentityPubkeyHex(null);
      return;
    }

    const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(masterSeedHex, topicId);
    setIdentityFingerprint(`${pubkeyHex.slice(0, 6)}…${pubkeyHex.slice(-6)}`);
    setIdentityPubkeyHex(pubkeyHex);
  }, [hasIdentity, keyStore, topicId]);

  useEffect(() => {
    if (!hasIdentity) {
      setLedger(null);
      setLedgerError("");
      return;
    }

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
  }, [hasIdentity, topicId]);

  if (tree.status === "loading") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 flex-shrink-0 items-center justify-center border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)]">
          <span className="font-display text-lg uppercase text-[color:var(--paper)]">
            {t("common.loading")}
          </span>
        </div>
        <div className="flex-1 p-8">
          <P5SkeletonList count={3} />
        </div>
      </div>
    );
  }

  if (tree.status === "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 flex-shrink-0 items-center justify-center border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)]">
          <span className="font-display text-lg uppercase text-[color:var(--paper)]">
            {t("common.error")}
          </span>
        </div>
        <div className="flex-1 p-8">
          <P5Alert role="alert" variant="error" title={t("common.error")}>
            {tree.errorMessage}
          </P5Alert>
        </div>
      </div>
    );
  }

  const isOwner =
    hasIdentity === true &&
    identityPubkeyHex !== null &&
    tree.topic.ownerPubkey !== null &&
    identityPubkeyHex === tree.topic.ownerPubkey;

  const claimInfo =
    hasIdentity === true && tree.topic.ownerPubkey === null
      ? (() => {
          try {
            return claimTokenStore.get(topicId);
          } catch {
            return null;
          }
        })()
      : null;

  async function claimOwner() {
    if (hasIdentity !== true) return;
    if (tree.status !== "success") return;
    if (tree.topic.ownerPubkey !== null) return;
    if (!claimInfo) return;

    setClaimError("");
    setIsClaiming(true);
    const result = await apiClient.executeTopicCommand(
      topicId,
      { type: "CLAIM_OWNER", payload: {} },
      { "x-claim-token": claimInfo.claimToken }
    );
    setIsClaiming(false);

    if (!result.ok) {
      setClaimError(result.error.message);
      toast({
        variant: "error",
        title: t("topic.claimHost"),
        message: result.error.message,
      });
      if (
        result.error.kind === "http" &&
        (result.error.code === "CLAIM_TOKEN_EXPIRED" ||
          result.error.code === "CLAIM_TOKEN_INVALID")
      ) {
        try {
          claimTokenStore.remove(topicId);
        } catch {
          // ignore
        }
      }
      return;
    }

    try {
      claimTokenStore.remove(topicId);
    } catch {
      // ignore
    }
    toast({
      variant: "success",
      title: t("topics.host"),
      message: t("topic.hostClaimedForTopic"),
    });
    invalidate();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Topic 专用 TopBar */}
      <TopicTopBar
        title={tree.topic.title}
        status={tree.topic.status}
        balance={ledger?.balance ?? null}
        identityFingerprint={identityFingerprint}
        showBackButton={true}
        reportButton={
          <P5Button
            onClick={() => setIsReportOpen(true)}
            size="sm"
            variant="ghost"
          >
            {t("topic.report")}
          </P5Button>
        }
        claimButton={
          claimInfo ? (
            <P5Button
              onClick={claimOwner}
              size="sm"
              variant="primary"
              disabled={isClaiming}
            >
              {isClaiming ? t("topic.claiming") : t("topic.claimHost")}
            </P5Button>
          ) : null
        }
        manageButton={
          isOwner ? (
            <P5Button
              onClick={() => setIsManageOpen((prev) => !prev)}
              size="sm"
              variant="ghost"
            >
              {t("topic.manage")}
            </P5Button>
          ) : null
        }
      />

      {/* 双栏布局 */}
      <TopicDualColumn
        left={
          <div className="flex h-full flex-col">
            {/* Identity Onboarding */}
            {hasIdentity === false && (
              <div className="mb-4">
                <IdentityOnboarding onComplete={() => setHasIdentity(true)} />
              </div>
            )}

            {/* Reload Banner */}
            {reloadRequired && (
              <div className="mb-4">
                <P5Alert title={t("topic.reloadRequiredTitle")} variant="warn" role="alert">
                  <div className="flex items-center justify-between">
                    <span>{t("topic.reloadRequiredMessage")}</span>
                    <P5Button onClick={() => window.location.reload()} size="sm">
                      {t("common.refresh")}
                    </P5Button>
                  </div>
                </P5Alert>
              </div>
            )}

            {/* Claim Error */}
            {claimError && (
              <div className="mb-4">
                <P5Alert role="alert" variant="error" title={t("topic.claimHost")}>
                  {claimError}
                </P5Alert>
              </div>
            )}

            {/* Ledger Error */}
            {ledgerError && (
              <div className="mb-4">
                <P5Alert role="alert" variant="error" title={t("topic.ledger")}>
                  {ledgerError}
                </P5Alert>
              </div>
            )}

            {/* ViewMode Tabs */}
            <div className="mb-4 flex items-center justify-between">
              <P5Tabs
                ariaLabel={t("topic.viewMode.label")}
                value={viewMode}
                onValueChange={setViewMode}
                tabs={[
                  { value: "focus", label: t("topic.viewMode.focus") },
                  { value: "sunburst", label: t("topic.viewMode.overview") },
                  { value: "god", label: t("topic.viewMode.god") },
                ]}
              />
            </div>

            {/* Visualization */}
            <div className="min-h-0 flex-1">
              {viewMode === "god" ? (
                <GodView topicId={topicId} refreshToken={refreshToken} />
              ) : viewMode === "sunburst" ? (
                <SunburstView
                  rootId={tree.topic.rootArgumentId}
                  nodes={tree.nodes}
                  selectedId={resolvedSelectedArgumentId}
                  onSelect={setSelectedArgumentId}
                />
              ) : (
                <FocusView
                  rootId={tree.topic.rootArgumentId}
                  nodes={tree.nodes}
                  selectedId={resolvedSelectedArgumentId}
                  onSelect={(id) => setSelectedArgumentId(id === rootArgumentId ? null : id)}
                />
              )}
            </div>
          </div>
        }
        right={
          <div className="flex h-full flex-col">
            {/* Selected Node Card */}
            <div className="flex-shrink-0 p-4">
              <SelectedNodeCard node={selectedNode} />
            </div>

            {/* DialogueStream */}
            <div className="min-h-0 flex-1 overflow-auto">
              <DialogueStream
                topicId={topicId}
                parentArgumentId={resolvedSelectedArgumentId}
                topicStatus={tree.topic.status}
                refreshToken={refreshToken}
                onInvalidate={invalidate}
                canWrite={hasIdentity === true}
                ledger={ledger}
                onLedgerUpdated={setLedger}
              />
            </div>
          </div>
        }
      />

      {/* Modals */}
      {isOwner && isManageOpen && (
        <TopicManagePanel
          topicId={topicId}
          topicTitle={tree.topic.title}
          topicStatus={tree.topic.status}
          topicVisibility={tree.topic.visibility}
          rootBody={tree.topic.rootBody}
          defaultArgumentId={selectedArgumentId}
          onInvalidate={invalidate}
          onClose={() => setIsManageOpen(false)}
        />
      )}

      {isReportOpen && (
        <ConsensusReportModal
          topicId={topicId}
          isOwner={isOwner}
          refreshToken={refreshToken}
          onInvalidate={invalidate}
          onClose={() => setIsReportOpen(false)}
        />
      )}
    </div>
  );
}
