import { P5Card } from "@/components/ui/P5Card";
import { CreateTopicForm } from "@/components/topics/CreateTopicForm";
import { createTranslator } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function NewTopicPage() {
  const t = createTranslator(await getRequestLocale());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title={t("topics.createTitle")}
        titleAs="h1"
        subtitle={t("topics.createSubtitle")}
        actions={[{ href: "/topics", label: t("common.back") }]}
      >
        <CreateTopicForm />
      </P5Card>
    </div>
  );
}
