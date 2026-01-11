import { P5Card } from "@/components/ui/P5Card";
import { createTranslator } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = createTranslator(await getRequestLocale());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title={t("notFound.title")}
        titleAs="h1"
        subtitle={t("notFound.subtitle")}
        actions={[{ href: "/topics", label: t("notFound.backToTopics") }]}
      >
        <p className="text-sm text-muted-foreground">
          {t("notFound.body")}
        </p>
      </P5Card>
    </div>
  );
}
