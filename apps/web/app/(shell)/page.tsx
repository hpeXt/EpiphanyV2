import Link from "next/link";

import { P5Badge } from "@/components/ui/P5Badge";
import { P5LinkButton } from "@/components/ui/P5Button";
import { P5Alert } from "@/components/ui/P5Alert";
import { TopicHostControls } from "@/components/topics/TopicHostControls";
import { apiClient } from "@/lib/apiClient";
import { BRAND } from "@/lib/brand";

export default async function Home() {
  const result = await apiClient.listTopics();

  if (!result.ok) {
    return (
      <P5Alert variant="error" title="加载失败">
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
            Collective Vibemakeing,
            <br />
            <span className="text-muted-foreground">Mapped</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {BRAND.description}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <P5LinkButton href="/topics/new" variant="primary">
              New Topic
            </P5LinkButton>
            <P5LinkButton href="/topics" variant="ghost">
              Browse Topics
            </P5LinkButton>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-serif text-2xl text-foreground">
              Active Discussions
            </h2>
            <P5LinkButton href="/topics/new" variant="ghost" size="sm">
              New Topic
            </P5LinkButton>
          </div>

          {topics.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-border/60 bg-card p-10 text-center">
              <p className="text-sm text-muted-foreground">No active topics yet.</p>
              <div className="mt-4">
                <P5LinkButton href="/topics/new" variant="primary" size="sm">
                  Create the first topic
                </P5LinkButton>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {topics.map((topic) => {
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
                      <Link href={`/topics/${topic.id}`} className="min-w-0 flex-1">
                        <h3 className="truncate font-serif text-xl text-foreground transition-colors group-hover:text-accent">
                          {topic.title}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{topic.id}</span>
                          <span aria-hidden>·</span>
                          <span>
                            {new Date(topic.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <P5Badge variant={badgeVariant}>{topic.status}</P5Badge>
                        {topic.ownerPubkey ? <P5Badge variant="ink">host</P5Badge> : null}
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
