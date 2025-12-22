"use client";

import { useMemo, useState } from "react";

import { generateMnemonic, mnemonicToMasterSeedHex, validateMnemonic } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { P5Tabs } from "@/components/ui/P5Tabs";
import { P5Textarea } from "@/components/ui/P5Textarea";

function normalizeMnemonicInput(input: string): string {
  return input.trim().split(/\s+/).join(" ");
}

export function IdentityOnboarding(props: { onComplete: () => void }) {
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [importMnemonic, setImportMnemonic] = useState("");
  const [error, setError] = useState("");

  function saveMnemonic(mnemonic: string) {
    const normalized = normalizeMnemonicInput(mnemonic);
    if (!validateMnemonic(normalized)) {
      setError("Invalid mnemonic");
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
            Set up your identity
          </h2>
          <p className="mt-1 text-xs text-white/80">
            This device stores your master seed locally. Back up the mnemonic before continuing.
          </p>
        </div>
      }
      bodyClassName="space-y-3"
    >
      <P5Tabs
        ariaLabel="Identity mode"
        value={mode}
        onValueChange={(next) => {
          setMode(next);
          setError("");
        }}
        tabs={[
          { value: "generate", label: "Generate" },
          { value: "import", label: "Import" },
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
            Generate 12-word mnemonic
          </P5Button>

          {generatedMnemonic ? (
            <div className="space-y-2">
              <P5Textarea
                aria-label="Generated mnemonic"
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
                I have backed it up
              </P5Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <P5Textarea
            aria-label="Mnemonic"
            value={importMnemonic}
            onChange={(event) => setImportMnemonic(event.target.value)}
            rows={3}
            className="font-mono text-xs"
            placeholder="Paste your 12/24-word mnemonic"
          />
          <P5Button type="button" onClick={() => saveMnemonic(importMnemonic)} variant="primary">
            Import mnemonic
          </P5Button>
        </div>
      )}

      {error ? (
        <P5Alert role="alert" variant="error" title="error">
          {error}
        </P5Alert>
      ) : null}
    </P5Panel>
  );
}
