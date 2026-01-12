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

            <div className="grid w-full gap-3 sm:grid-cols-2">
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
              <P5LinkButton href="#how" variant="ghost">
                {t("home.learnHow")}
              </P5LinkButton>
            </div>
          </div>
        </div>
      </section>

      <section id="manifesto">
        <div className="mx-auto max-w-3xl">
          <div className="prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-code:before:content-none prose-code:after:content-none">
            <h2>{t("home.manifesto.title")}</h2>
            <p>{t("home.manifesto.p1")}</p>
            <p>{t("home.manifesto.p2")}</p>
            <p>{t("home.manifesto.p3")}</p>
          </div>
        </div>
      </section>

      <section id="preview">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-serif text-2xl tracking-tight text-foreground">
                {t("home.preview.label")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t("brand.description")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                t("home.preview.chipExplore"),
                t("home.preview.chipRead"),
                t("home.preview.chipVote"),
                t("home.preview.chipReport"),
              ].map((chip) => (
                <P5Badge key={chip} variant="paper" className="text-muted-foreground">
                  {chip}
                </P5Badge>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-card p-6 shadow-sm">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                {t("home.preview.topicLabel")}
              </p>
              <h3 className="mt-3 font-serif text-2xl tracking-tight text-foreground">
                {t("home.preview.topicTitle")}
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {t("home.preview.topicBody")}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  label: t("home.preview.statMapLabel"),
                  value: t("home.preview.statMapValue"),
                },
                {
                  label: t("home.preview.statVoteLabel"),
                  value: t("home.preview.statVoteValue"),
                },
                {
                  label: t("home.preview.statReadLabel"),
                  value: t("home.preview.statReadValue"),
                },
                {
                  label: t("home.preview.statReportLabel"),
                  value: t("home.preview.statReportValue"),
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
                >
                  <p className="text-xs font-medium tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-2 font-serif text-lg leading-snug text-foreground">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <h2 className="font-serif text-2xl tracking-tight text-foreground">
              {t("home.sections.capabilitiesTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("home.sections.capabilitiesSubtitle")}
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: t("home.features.anonymous.title"),
                body: t("home.features.anonymous.body"),
              },
              {
                title: t("home.features.structured.title"),
                body: t("home.features.structured.body"),
              },
              {
                title: t("home.features.qv.title"),
                body: t("home.features.qv.body"),
              },
              {
                title: t("home.features.mapAi.title"),
                body: t("home.features.mapAi.body"),
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
              >
                <h3 className="font-serif text-lg tracking-tight text-foreground">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <h2 className="font-serif text-2xl tracking-tight text-foreground">
              {t("home.sections.howTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("home.sections.howSubtitle")}
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: t("home.steps.create.title"),
                body: t("home.steps.create.body"),
              },
              {
                title: t("home.steps.post.title"),
                body: t("home.steps.post.body"),
              },
              {
                title: t("home.steps.vote.title"),
                body: t("home.steps.vote.body"),
              },
              {
                title: t("home.steps.summarize.title"),
                body: t("home.steps.summarize.body"),
              },
            ].map((step) => (
                <div
                  key={step.title}
                  className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
                >
                  <h3 className="font-serif text-lg tracking-tight text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              ))}
          </div>
        </div>
      </section>

      <section id="use-cases">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <h2 className="font-serif text-2xl tracking-tight text-foreground">
              {t("home.sections.useCasesTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("home.sections.useCasesSubtitle")}
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                title: t("home.useCases.team.title"),
                body: t("home.useCases.team.body"),
              },
              {
                title: t("home.useCases.community.title"),
                body: t("home.useCases.community.body"),
              },
              {
                title: t("home.useCases.product.title"),
                body: t("home.useCases.product.body"),
              },
            ].map((useCase) => (
                <div
                  key={useCase.title}
                  className="rounded-lg border border-border/60 bg-card p-6 shadow-sm"
                >
                  <h3 className="font-serif text-lg tracking-tight text-foreground">
                    {useCase.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{useCase.body}</p>
                </div>
              ))}
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-5xl rounded-lg border border-border/60 bg-card p-10 text-center shadow-sm">
          <h2 className="font-serif text-3xl tracking-tight text-foreground">{t("home.ctaTitle")}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t("home.ctaSubtitle")}
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <P5LinkButton href="/topics/new" variant="primary">
              {t("home.newTopic")}
            </P5LinkButton>
            <P5LinkButton href="#how" variant="ghost">
              {t("home.learnHow")}
            </P5LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
