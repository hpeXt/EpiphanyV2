import Link from "next/link";

import { P5Alert } from "@/components/ui/P5Alert";
import { P5Badge } from "@/components/ui/P5Badge";
import { P5Card } from "@/components/ui/P5Card";
import { apiClient } from "@/lib/apiClient";

export default async function TopicsPage() {
  const result = await apiClient.listTopics();

  if (!result.ok) {
    return (
      <P5Alert variant="error" title="加载失败">
        {result.error.message}
      </P5Alert>
    );
  }

  const topics = result.data.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <P5Card
        title="Topics"
        titleAs="h1"
        subtitle="Pick a topic or start a new one."
        actions={[{ href: "/topics/new", label: "New topic", variant: "primary" }]}
      >
        {topics.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {topics.map((topic) => {
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
                    aria-label={topic.title}
                    className="block rounded-lg border border-border/60 bg-card px-4 py-4 shadow-sm transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-serif text-lg font-semibold text-foreground">
                          {topic.title}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {topic.id}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <P5Badge variant={badgeVariant} aria-hidden>
                          {topic.status}
                        </P5Badge>
                        {topic.ownerPubkey ? (
                          <P5Badge variant="ink" aria-hidden>
                            host
                          </P5Badge>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </P5Card>
    </div>
  );
}
