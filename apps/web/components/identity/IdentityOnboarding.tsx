"use client";

import { useMemo, useState } from "react";

import { generateMnemonic, mnemonicToMasterSeedHex, validateMnemonic } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";

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
    <section className="space-y-3 rounded-md border border-zinc-200 bg-white p-4">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-900">Set up your identity</h2>
        <p className="text-xs text-zinc-600">
          This device stores your master seed locally. Back up the mnemonic before continuing.
        </p>
      </header>

      <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode("generate");
            setError("");
          }}
          aria-pressed={mode === "generate"}
          className={[
            "rounded-md px-2 py-1",
            mode === "generate" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100",
          ].join(" ")}
        >
          Generate
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("import");
            setError("");
          }}
          aria-pressed={mode === "import"}
          className={[
            "rounded-md px-2 py-1",
            mode === "import" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100",
          ].join(" ")}
        >
          Import
        </button>
      </div>

      {mode === "generate" ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setGeneratedMnemonic(generateMnemonic(12));
              setError("");
            }}
            className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white"
          >
            Generate 12-word mnemonic
          </button>

          {generatedMnemonic ? (
            <div className="space-y-2">
              <textarea
                aria-label="Generated mnemonic"
                readOnly
                value={generatedMnemonic}
                rows={3}
                className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => saveMnemonic(generatedMnemonic)}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
              >
                I have backed it up
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            aria-label="Mnemonic"
            value={importMnemonic}
            onChange={(event) => setImportMnemonic(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs"
            placeholder="Paste your 12/24-word mnemonic"
          />
          <button
            type="button"
            onClick={() => saveMnemonic(importMnemonic)}
            className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white"
          >
            Import mnemonic
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

