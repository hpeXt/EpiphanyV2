"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { LedgerMe } from "@epiphany/shared-contracts";

import { IdentityOnboarding } from "@/components/identity/IdentityOnboarding";
import { FocusView } from "@/components/topics/FocusView";
import { DialogueStream } from "@/components/topics/DialogueStream";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";
import { useTopicSse } from "@/components/topics/hooks/useTopicSse";
import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
import { apiClient } from "@/lib/apiClient";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { TopicManagePanel } from "@/components/topics/TopicManagePanel";

type Props = {
  topicId: string;
};

export function TopicPage({ topicId }: Props) {
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);
  const [identityFingerprint, setIdentityFingerprint] = useState<string | null>(null);
  const [identityPubkeyHex, setIdentityPubkeyHex] = useState<string | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);

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
    try {
      setHasIdentity(Boolean(keyStore.getMasterSeedHex()));
    } catch {
      setHasIdentity(false);
    }
  }, [keyStore]);

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

  const isOwner =
    hasIdentity === true &&
    identityPubkeyHex !== null &&
    tree.topic.ownerPubkey !== null &&
    identityPubkeyHex === tree.topic.ownerPubkey;

  return (
    <div className="space-y-6">
      {hasIdentity === false ? (
        <IdentityOnboarding onComplete={() => setHasIdentity(true)} />
      ) : null}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{tree.topic.title}</h1>
          {isOwner ? (
            <button
              type="button"
              onClick={() => setIsManageOpen((prev) => !prev)}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
            >
              Manage
            </button>
          ) : null}
        </div>
        <p className="text-sm text-zinc-600">
          TopicId: <code className="font-mono">{tree.topic.id}</code>
        </p>
        <p className="text-sm text-zinc-600">
          Status: <span className="font-mono">{tree.topic.status}</span>
        </p>
        {identityFingerprint ? (
          <p className="text-sm text-zinc-600">
            Identity: <span className="font-mono">{identityFingerprint}</span>
          </p>
        ) : null}
        {ledger ? (
          <p className="text-sm text-zinc-600">
            Balance: <span className="font-mono">{ledger.balance}</span>
          </p>
        ) : ledgerError ? (
          <p className="text-sm text-red-700">{ledgerError}</p>
        ) : null}
      </header>

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
