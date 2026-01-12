import { P5Alert } from "@/components/ui/P5Alert";
import { P5Card } from "@/components/ui/P5Card";
import { TopicsPageClient } from "@/components/topics/TopicsPageClient";
import { createApiClient } from "@/lib/apiClient";
import { createTranslator } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function TopicsPage() {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const apiClient = createApiClient({ locale });
  const result = await apiClient.listTopics();

  if (!result.ok) {
    return (
      <P5Alert variant="error" title={t("common.loadFailed")}>
        {result.error.message}
      </P5Alert>
    );
  }

  const topics = result.data.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <P5Card
        title={t("topics.title")}
        titleAs="h1"
        subtitle={t("topics.subtitle")}
        actions={[{ href: "/topics/new", label: t("topics.newTopic"), variant: "primary" }]}
      >
        <TopicsPageClient
          publicTopics={topics.map((topic) => ({
            id: topic.id,
            title: topic.title,
            status: topic.status,
            visibility: topic.visibility,
            ownerPubkey: topic.ownerPubkey,
            createdAt: topic.createdAt,
          }))}
        />
      </P5Card>
    </div>
  );
}
