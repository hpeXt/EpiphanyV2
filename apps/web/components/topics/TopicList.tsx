"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { apiClient } from "@/lib/apiClient";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { useI18n } from "@/components/i18n/I18nProvider";

export function TopicList() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"loading" | "error" | "success">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      status: "active" | "frozen" | "archived";
      ownerPubkey: string | null;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await apiClient.listTopics();
      if (cancelled) return;

      if (!result.ok) {
        setErrorMessage(result.error.message);
        setStatus("error");
        return;
      }

      setItems(
        result.data.items.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          ownerPubkey: t.ownerPubkey,
        })),
      );
      setStatus("success");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <p className="font-mono text-sm text-[color:var(--ink)] opacity-80">
        {t("common.loadingDots")}
      </p>
    );
  }

  if (status === "error") {
    return (
      <P5Alert variant="error" title={t("common.error")}>
        {errorMessage}
      </P5Alert>
    );
  }

  if (items.length === 0) {
    return (
      <P5Alert variant="info" title={t("common.empty")}>
        {t("topics.noTopicsYet")}
      </P5Alert>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((topic, index) => {
        const title = topic.title.trim() ? topic.title : t("topics.untitled");
        const badgeVariant =
          topic.status === "active"
            ? "electric"
            : topic.status === "frozen"
              ? "acid"
              : "ink";

        return (
        <li key={topic.id}>
          <Link
            href={`/topics/${topic.id}`}
            aria-label={title}
            className={[
              "block",
              "border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-ink)]",
              "px-4 py-3",
              "transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5",
              index % 2 === 0 ? "rotate-[-0.4deg]" : "rotate-[0.3deg]",
            ].join(" ")}
            style={{
              clipPath:
                "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                  {title}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <P5Badge variant={badgeVariant} aria-hidden>
                  {t(`status.${topic.status}`)}
                </P5Badge>
                {topic.ownerPubkey ? (
                  <P5Badge variant="ink" aria-hidden>
                    {t("topics.host")}
                  </P5Badge>
                ) : null}
              </div>
            </div>
          </Link>
        </li>
        );
      })}
    </ul>
  );
}
