import Link from "next/link";

import { P5Badge } from "@/components/ui/P5Badge";
import { P5LinkButton } from "@/components/ui/P5Button";
import { P5Alert } from "@/components/ui/P5Alert";
import { TopicHostControls } from "@/components/topics/TopicHostControls";
import { apiClient } from "@/lib/apiClient";
import { createTranslator, toDateLocale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function Home() {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);

  const result = await apiClient.listTopics();

  if (!result.ok) {
    return (
      <P5Alert variant="error" title={t("common.loadFailed")}>
        {result.error.message}
      </P5Alert>
    );
  }

  const topics = result.data.items
    .filter((t) => t.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-16">
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-serif text-4xl leading-tight text-foreground md:text-5xl lg:text-6xl">
            {t("home.heroTitleLine1")}
            <br />
            <span className="text-muted-foreground">{t("home.heroTitleLine2")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {t("brand.description")}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <P5LinkButton href="/topics/new" variant="primary">
              {t("home.newTopic")}
            </P5LinkButton>
            <P5LinkButton href="/topics" variant="ghost">
              {t("home.browseTopics")}
            </P5LinkButton>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-serif text-2xl text-foreground">
              {t("home.activeDiscussions")}
            </h2>
            <P5LinkButton href="/topics/new" variant="ghost" size="sm">
              {t("home.newTopic")}
            </P5LinkButton>
          </div>

          {topics.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-border/60 bg-card p-10 text-center">
              <p className="text-sm text-muted-foreground">{t("home.noActiveTopicsYet")}</p>
              <div className="mt-4">
                <P5LinkButton href="/topics/new" variant="primary" size="sm">
                  {t("home.createFirstTopic")}
                </P5LinkButton>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {topics.map((topic) => {
                const title = topic.title.trim() ? topic.title : t("topics.untitled");
                const badgeVariant =
                  topic.status === "active"
                    ? "electric"
                    : topic.status === "frozen"
                      ? "acid"
                      : "ink";

                return (
                  <article
                    key={topic.id}
                    className="group rounded-lg border border-border/60 bg-card p-6 shadow-sm transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <Link href={`/topics/${topic.id}`} aria-label={title} className="min-w-0 flex-1">
                        <h3 className="truncate font-serif text-xl text-foreground transition-colors group-hover:text-accent">
                          {title}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {new Date(topic.createdAt).toLocaleDateString(toDateLocale(locale), {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <P5Badge variant={badgeVariant}>{t(`status.${topic.status}`)}</P5Badge>
                        {topic.ownerPubkey ? <P5Badge variant="ink">{t("topics.host")}</P5Badge> : null}
                        <TopicHostControls topicId={topic.id} ownerPubkey={topic.ownerPubkey} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
