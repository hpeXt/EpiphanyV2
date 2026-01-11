"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { TopicSummary } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";
import { createLocalStorageVisitedTopicsStore } from "@/lib/visitedTopicsStore";
import { TopicHostControls } from "@/components/topics/TopicHostControls";
import { useI18n } from "@/components/i18n/I18nProvider";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Tabs } from "@/components/ui/P5Tabs";

type TopicLite = Pick<TopicSummary, "id" | "title" | "status" | "visibility" | "ownerPubkey" | "createdAt">;

type Tab = "public" | "visited";

type VisitedState =
  | { status: "idle"; topics: []; totalCount: 0; failedCount: 0 }
  | { status: "loading"; topics: TopicLite[]; totalCount: number; failedCount: number }
  | { status: "success"; topics: TopicLite[]; totalCount: number; failedCount: number };

const MAX_VISITED_TOPICS = 30;

function statusVariant(status: TopicLite["status"]) {
  return status === "active" ? "electric" : status === "frozen" ? "acid" : "ink";
}

export function TopicsPageClient({ publicTopics }: { publicTopics: TopicLite[] }) {
  const { t } = useI18n();

  const [tab, setTab] = useState<Tab>("public");
  const [visited, setVisited] = useState<VisitedState>({
    status: "idle",
    topics: [],
    totalCount: 0,
    failedCount: 0,
  });

  const publicTopicIdsKey = useMemo(() => publicTopics.map((topic) => topic.id).join("|"), [publicTopics]);

  const publicById = useMemo(() => {
    const map = new Map<string, TopicLite>();
    for (const topic of publicTopics) {
      map.set(topic.id, topic);
    }
    return map;
  }, [publicTopics]);

  useEffect(() => {
    let cancelled = false;

    async function loadVisitedTopics() {
      const store = createLocalStorageVisitedTopicsStore();
      const uniqueTopicIds = Array.from(new Set(store.getTopicIds()));
      const visitedIds = uniqueTopicIds.slice(-MAX_VISITED_TOPICS).reverse();

      setVisited((prev) => ({
        status: "loading",
        topics: prev.status === "success" ? prev.topics : [],
        totalCount: visitedIds.length,
        failedCount: 0,
      }));

      let failedCount = 0;
      const topics: TopicLite[] = [];

      const results = await Promise.all(
        visitedIds.map(async (topicId) => {
          const known = publicById.get(topicId);
          if (known) return { ok: true as const, topic: known };

          const result = await apiClient.getTopicTree(topicId, 1);
          if (!result.ok) {
            return { ok: false as const };
          }

          const topic = result.data.topic;
          return {
            ok: true as const,
            topic: {
              id: topic.id,
              title: topic.title,
              status: topic.status,
              visibility: topic.visibility,
              ownerPubkey: topic.ownerPubkey,
              createdAt: topic.createdAt,
            } satisfies TopicLite,
          };
        }),
      );

      for (const result of results) {
        if (!result.ok) {
          failedCount += 1;
          continue;
        }
        topics.push(result.topic);
      }

      if (cancelled) return;

      setVisited({
        status: "success",
        topics,
        totalCount: visitedIds.length,
        failedCount,
      });
    }

    void loadVisitedTopics();

    const handleFocus = () => {
      void loadVisitedTopics();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadVisitedTopics();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [publicById, publicTopicIdsKey]);

  const tabLabelPublic = `${t("createTopic.visibility.public")} (${publicTopics.length})`;
  const visitedLabelCount = visited.status === "idle" ? "" : ` (${visited.totalCount})`;
  const tabLabelVisited = `${t("my.visitedTopicsTitle")}${visitedLabelCount}`;

  const showingTopics = tab === "public" ? publicTopics : visited.topics;
  const showVisibility = tab === "visited";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <P5Tabs<Tab>
          value={tab}
          ariaLabel={t("nav.topics")}
          onValueChange={setTab}
          tabs={[
            { value: "public", label: tabLabelPublic },
            { value: "visited", label: tabLabelVisited },
          ]}
        />

        {tab === "visited" ? (
          <p className="max-w-xl text-xs text-muted-foreground">
            {t("topics.visitedHint")}
          </p>
        ) : null}
      </div>

      {tab === "visited" && visited.status !== "idle" && visited.failedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("topics.visitedPartialLoadFailed", { count: visited.failedCount })}
        </p>
      ) : null}

      {tab === "visited" && visited.status === "loading" ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingDots")}</p>
      ) : null}

      {tab === "visited" && visited.status === "success" && visited.totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("topics.visitedEmptyTitle")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("topics.visitedEmptyBody")}</p>
        </div>
      ) : null}

      {tab === "visited" && visited.status === "success" && visited.totalCount > 0 && visited.topics.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("common.loadFailed")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("createTopic.visibilityHelp")}</p>
        </div>
      ) : null}

      {tab === "public" && publicTopics.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("topics.noTopicsYet")}</p>
        </div>
      ) : null}

      {(tab === "public" ? publicTopics.length > 0 : visited.status === "success" && visited.topics.length > 0) ? (
        <ul className="space-y-3">
          {showingTopics.map((topic) => {
            const title = topic.title.trim() ? topic.title : t("topics.untitled");
            const visibilityLabel =
              showVisibility && topic.visibility !== "public"
                ? t(`createTopic.visibility.${topic.visibility}`)
                : null;

            return (
              <li key={topic.id}>
                <div className="rounded-lg border border-border/60 bg-card px-4 py-4 shadow-sm transition-colors hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/topics/${topic.id}`} aria-label={title} className="min-w-0 flex-1">
                      <div className="truncate font-serif text-lg font-semibold text-foreground">
                        {title}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {topic.createdAt.slice(0, 10)}
                      </div>
                    </Link>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <P5Badge variant={statusVariant(topic.status)} aria-hidden>
                        {t(`status.${topic.status}`)}
                      </P5Badge>

                      {visibilityLabel ? <P5Badge aria-hidden>{visibilityLabel}</P5Badge> : null}

                      {topic.ownerPubkey ? (
                        <P5Badge variant="ink" aria-hidden>
                          {t("topics.host")}
                        </P5Badge>
                      ) : null}

                      <TopicHostControls topicId={topic.id} ownerPubkey={topic.ownerPubkey} />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
