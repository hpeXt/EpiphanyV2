"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { LedgerMe } from "@epiphany/shared-contracts";

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
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { P5Tabs } from "@/components/ui/P5Tabs";
import { useP5Toast } from "@/components/ui/P5ToastProvider";

type Props = {
  topicId: string;
};

export function TopicPage({ topicId }: Props) {
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
    null,
  );
  const [viewMode, setViewMode] = useState<"focus" | "god" | "sunburst">("focus");
  const [ledger, setLedger] = useState<LedgerMe | null>(null);
  const [ledgerError, setLedgerError] = useState("");

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
      <P5Alert role="status" variant="info" title="topic">
        Loading topic…
      </P5Alert>
    );
  }

  if (tree.status === "error") {
    return (
      <P5Alert role="alert" variant="error" title="error">
        {tree.errorMessage}
      </P5Alert>
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
      { "x-claim-token": claimInfo.claimToken },
    );
    setIsClaiming(false);

    if (!result.ok) {
      setClaimError(result.error.message);
      toast({
        variant: "error",
        title: "claim",
        message: result.error.message,
      });
      if (result.error.kind === "http" && (result.error.code === "CLAIM_TOKEN_EXPIRED" || result.error.code === "CLAIM_TOKEN_INVALID")) {
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
      title: "host",
      message: "Host claimed for this topic.",
    });
    invalidate();
  }

  const statusBadgeVariant =
    tree.topic.status === "active"
      ? "electric"
      : tree.topic.status === "frozen"
        ? "acid"
        : "ink";

  return (
    <div className="space-y-6">
      {hasIdentity === false ? (
        <IdentityOnboarding onComplete={() => setHasIdentity(true)} />
      ) : null}
      {reloadRequired ? (
        <P5Alert title="reload_required" variant="warn" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Realtime stream is out of date. Please refresh.</span>
            <P5Button
              type="button"
              onClick={() => window.location.reload()}
              variant="ink"
              size="sm"
            >
              Refresh
            </P5Button>
          </div>
        </P5Alert>
      ) : null}

      <P5Panel
        header={
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
            <div className="min-w-0">
              <div className="font-mono text-xs font-semibold uppercase tracking-wide text-white/80">
                Topic
              </div>
              <h1 className="truncate text-xl font-semibold">{tree.topic.title}</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <P5Badge variant={statusBadgeVariant}>{tree.topic.status}</P5Badge>
              {identityFingerprint ? (
                <P5Badge variant="paper" className="font-mono normal-case tracking-normal">
                  {identityFingerprint}
                </P5Badge>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1 text-sm text-[color:var(--ink)]">
            <p>
              TopicId: <code className="font-mono">{tree.topic.id}</code>
            </p>
            <p>
              Status: <span className="font-mono">{tree.topic.status}</span>
            </p>
            {ledger ? (
              <p>
                Balance: <span className="font-mono">{ledger.balance}</span>
              </p>
            ) : ledgerError ? (
              <p className="text-[color:var(--rebel-red)]">{ledgerError}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
            <P5Tabs
              ariaLabel="Topic view mode"
              value={viewMode}
              onValueChange={setViewMode}
              tabs={[
                { value: "focus", label: "Focus" },
                { value: "sunburst", label: "Overview" },
                { value: "god", label: "God View" },
              ]}
            />

            <P5Button type="button" onClick={() => setIsReportOpen(true)} size="sm">
              Report
            </P5Button>

            {claimInfo ? (
              <P5Button
                type="button"
                onClick={claimOwner}
                size="sm"
                variant="primary"
                disabled={isClaiming}
              >
                {isClaiming ? "Claiming…" : "Claim Host"}
              </P5Button>
            ) : null}

            {isOwner ? (
              <P5Button
                type="button"
                onClick={() => setIsManageOpen((prev) => !prev)}
                size="sm"
              >
                Manage
              </P5Button>
            ) : null}
          </div>
        </div>
      </P5Panel>

      {claimError ? (
        <P5Alert role="alert" variant="error" title="claim">
          {claimError}
        </P5Alert>
      ) : null}

      {isOwner && isManageOpen ? (
        <TopicManagePanel
          topicId={topicId}
          topicTitle={tree.topic.title}
          topicStatus={tree.topic.status}
          rootBody={tree.topic.rootBody}
          onInvalidate={invalidate}
          onClose={() => setIsManageOpen(false)}
        />
      ) : null}

      {isReportOpen ? (
        <ConsensusReportModal
          topicId={topicId}
          isOwner={isOwner}
          refreshToken={refreshToken}
          onInvalidate={invalidate}
          onClose={() => setIsReportOpen(false)}
        />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_1.25fr]">
        {viewMode === "god" ? (
          <GodView topicId={topicId} refreshToken={refreshToken} />
        ) : viewMode === "sunburst" ? (
          <SunburstView
            rootId={tree.topic.rootArgumentId}
            nodes={tree.nodes}
            selectedId={selectedArgumentId}
            onSelect={setSelectedArgumentId}
          />
        ) : (
          <FocusView
            rootId={tree.topic.rootArgumentId}
            nodes={tree.nodes}
            selectedId={selectedArgumentId}
            onSelect={setSelectedArgumentId}
          />
        )}
        <DialogueStream
          topicId={topicId}
          parentArgumentId={selectedArgumentId}
          topicStatus={tree.topic.status}
          refreshToken={refreshToken}
          onInvalidate={invalidate}
          canWrite={hasIdentity === true}
          ledger={ledger}
          onLedgerUpdated={setLedger}
        />
      </div>
    </div>
  );
}
