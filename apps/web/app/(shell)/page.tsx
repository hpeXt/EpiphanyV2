import { P5Badge } from "@/components/ui/P5Badge";
import { P5LinkButton } from "@/components/ui/P5Button";
import { createTranslator } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function Home() {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);

  return (
    <div className="space-y-24">
      <section className="py-12 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-start gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <P5Badge variant="paper" className="text-muted-foreground">
                {t("home.heroEyebrow")}
              </P5Badge>
            </div>

            <h1 className="font-serif text-4xl leading-tight text-foreground md:text-5xl lg:text-6xl">
              {t("home.heroTitleLine1")}
              <br />
              <span className="text-muted-foreground">{t("home.heroTitleLine2")}</span>
            </h1>

            <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
              {t("home.heroSubtitle")}
            </p>

            <div id="how" className="grid w-full gap-3 sm:grid-cols-2">
              {[
                t("home.heroBullets.anonymous"),
                t("home.heroBullets.structure"),
                t("home.heroBullets.qv"),
                t("home.heroBullets.mapAi"),
              ].map((bullet) => (
                <div
                  key={bullet}
                  className="rounded-lg border border-border/60 bg-card p-4 text-sm leading-relaxed text-muted-foreground shadow-sm"
                >
                  {bullet}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <P5LinkButton href="/topics/new" variant="primary">
                {t("home.newTopic")}
              </P5LinkButton>
              <P5LinkButton href="/topics" variant="ghost">
                {t("home.browseTopics")}
              </P5LinkButton>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
