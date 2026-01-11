"use client";

import { useEffect } from "react";

import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Card } from "@/components/ui/P5Card";
import { useI18n } from "@/components/i18n/I18nProvider";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    console.error(props.error);
  }, [props.error]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title={t("globalError.title")}
        titleAs="h1"
        subtitle={t("globalError.subtitle")}
        actions={[{ href: "/topics", label: t("globalError.backToTopics") }]}
      >
        <div className="space-y-3">
          <P5Alert variant="error" title={t("common.error")} role="alert">
            {props.error.message || t("globalError.unknownError")}
          </P5Alert>
          <div className="flex flex-wrap gap-2">
            <P5Button type="button" variant="primary" onClick={() => props.reset()}>
              {t("globalError.tryAgain")}
            </P5Button>
          </div>
        </div>
      </P5Card>
    </div>
  );
}
