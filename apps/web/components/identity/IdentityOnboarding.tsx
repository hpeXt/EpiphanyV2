"use client";

import { useMemo, useState } from "react";

import { generateMnemonic, mnemonicToMasterSeedHex, validateMnemonic } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { P5Tabs } from "@/components/ui/P5Tabs";
import { P5Textarea } from "@/components/ui/P5Textarea";
import { useI18n } from "@/components/i18n/I18nProvider";

function normalizeMnemonicInput(input: string): string {
  return input.trim().split(/\s+/).join(" ");
}

export function IdentityOnboarding(props: { onComplete: () => void }) {
  const { t } = useI18n();
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [importMnemonic, setImportMnemonic] = useState("");
  const [error, setError] = useState("");

  function saveMnemonic(mnemonic: string) {
    const normalized = normalizeMnemonicInput(mnemonic);
    if (!validateMnemonic(normalized)) {
      setError(t("identity.invalidMnemonic"));
      return;
    }

    const masterSeedHex = mnemonicToMasterSeedHex(normalized);
    keyStore.setMasterSeedHex(masterSeedHex);
    props.onComplete();
  }

  return (
    <P5Panel
      header={
        <div className="bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide">
            {t("identity.setupTitle")}
          </h2>
          <p className="mt-1 text-xs text-white/80">
            {t("identity.setupSubtitle")}
          </p>
        </div>
      }
      bodyClassName="space-y-3"
    >
      <P5Tabs
        ariaLabel={t("identity.modeLabel")}
        value={mode}
        onValueChange={(next) => {
          setMode(next);
          setError("");
        }}
        tabs={[
          { value: "generate", label: t("identity.generate") },
          { value: "import", label: t("identity.import") },
        ]}
      />

      {mode === "generate" ? (
        <div className="space-y-2">
          <P5Button
            type="button"
            onClick={() => {
              setGeneratedMnemonic(generateMnemonic(12));
              setError("");
            }}
            variant="primary"
          >
            {t("identity.generateMnemonic")}
          </P5Button>

          {generatedMnemonic ? (
            <div className="space-y-2">
              <P5Textarea
                aria-label={t("identity.generatedMnemonic")}
                readOnly
                value={generatedMnemonic}
                rows={3}
                className="bg-[color:var(--concrete-200)] font-mono text-xs"
              />
              <P5Button
                type="button"
                onClick={() => saveMnemonic(generatedMnemonic)}
                variant="ghost"
              >
                {t("identity.backedUp")}
              </P5Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <P5Textarea
            aria-label={t("identity.mnemonic")}
            value={importMnemonic}
            onChange={(event) => setImportMnemonic(event.target.value)}
            rows={3}
            className="font-mono text-xs"
            placeholder={t("identity.pasteMnemonic")}
          />
          <P5Button type="button" onClick={() => saveMnemonic(importMnemonic)} variant="primary">
            {t("identity.importMnemonic")}
          </P5Button>
        </div>
      )}

      {error ? (
        <P5Alert role="alert" variant="error" title={t("common.error")}>
          {error}
        </P5Alert>
      ) : null}
    </P5Panel>
  );
}
