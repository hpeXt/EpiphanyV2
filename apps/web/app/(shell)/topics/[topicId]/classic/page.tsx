import { TopicPage } from "@/components/topics/TopicPage";
import { P5LinkButton } from "@/components/ui/P5Button";
import { createTranslator } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

type Params = { topicId: string };

export default async function TopicDetailPage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  const { topicId } = await params;
  const t = createTranslator(await getRequestLocale());

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <P5LinkButton href="/topics" variant="ghost" size="sm">
          {t("topics.backToList")}
        </P5LinkButton>
      </header>
      <TopicPage topicId={topicId} />
    </div>
  );
}
