"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiClient } from "@/lib/apiClient";
import { createLocalStorageClaimTokenStore, type ClaimTokenInfo } from "@/lib/claimTokenStore";
import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { P5Button, P5LinkButton } from "@/components/ui/P5Button";
import { useP5Toast } from "@/components/ui/P5ToastProvider";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  topicId: string;
  ownerPubkey: string | null;
  size?: "sm" | "md";
};

export function TopicHostControls({ topicId, ownerPubkey, size = "sm" }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const { toast } = useP5Toast();

  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const claimTokenStore = useMemo(() => createLocalStorageClaimTokenStore(), []);

  const [effectiveOwnerPubkey, setEffectiveOwnerPubkey] = useState(ownerPubkey);
  const [myPubkeyHex, setMyPubkeyHex] = useState<string | null>(null);
  const [claimInfo, setClaimInfo] = useState<ClaimTokenInfo | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    setEffectiveOwnerPubkey(ownerPubkey);
  }, [ownerPubkey]);

  useEffect(() => {
    try {
      const masterSeedHex = keyStore.getMasterSeedHex();
      if (!masterSeedHex) {
        setMyPubkeyHex(null);
        return;
      }
      const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(masterSeedHex, topicId);
      setMyPubkeyHex(pubkeyHex);
    } catch {
      setMyPubkeyHex(null);
    }
  }, [keyStore, topicId]);

  useEffect(() => {
    if (!myPubkeyHex) {
      setClaimInfo(null);
      return;
    }
    if (effectiveOwnerPubkey !== null) {
      setClaimInfo(null);
      return;
    }

    try {
      setClaimInfo(claimTokenStore.get(topicId));
    } catch {
      setClaimInfo(null);
    }
  }, [claimTokenStore, effectiveOwnerPubkey, myPubkeyHex, topicId]);

  const isOwner =
    myPubkeyHex !== null &&
    effectiveOwnerPubkey !== null &&
    myPubkeyHex === effectiveOwnerPubkey.toLowerCase();

  const canClaim = myPubkeyHex !== null && effectiveOwnerPubkey === null && claimInfo !== null;

  async function claimOwner() {
    if (!canClaim || !claimInfo) return;
    if (isClaiming) return;

    setIsClaiming(true);
    const result = await apiClient.executeTopicCommand(
      topicId,
      { type: "CLAIM_OWNER", payload: {} },
      { "x-claim-token": claimInfo.claimToken },
    );
    setIsClaiming(false);

    if (!result.ok) {
      toast({ variant: "error", title: t("topic.claimHost"), message: result.error.message });
      if (
        result.error.kind === "http" &&
        (result.error.code === "CLAIM_TOKEN_EXPIRED" || result.error.code === "CLAIM_TOKEN_INVALID")
      ) {
        try {
          claimTokenStore.remove(topicId);
        } catch {
          // ignore
        }
        setClaimInfo(null);
      }
      return;
    }

    try {
      claimTokenStore.remove(topicId);
    } catch {
      // ignore
    }

    setClaimInfo(null);
    setEffectiveOwnerPubkey(myPubkeyHex);
    toast({ variant: "success", title: t("topics.host"), message: t("topic.hostClaimed") });
    router.refresh?.();
  }

  if (!isOwner && !canClaim) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isOwner ? (
        <P5LinkButton href={`/topics/${topicId}?manage=1`} variant="ghost" size={size}>
          {t("topic.manage")}
        </P5LinkButton>
      ) : null}
      {canClaim ? (
        <P5Button
          type="button"
          onClick={claimOwner}
          disabled={isClaiming}
          variant="primary"
          size={size}
        >
          {isClaiming ? t("topic.claiming") : t("topic.claimHost")}
        </P5Button>
      ) : null}
    </div>
  );
}
