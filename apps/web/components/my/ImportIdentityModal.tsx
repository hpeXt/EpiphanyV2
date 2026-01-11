"use client";

import { useCallback, useState } from "react";
import { P5Modal } from "@/components/ui/P5Modal";
import { P5Button } from "@/components/ui/P5Button";
import { P5Textarea } from "@/components/ui/P5Textarea";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  validateMnemonic,
} from "@/lib/identity";

type Props = {
  open: boolean;
  onClose: () => void;
  onImport: (mnemonic: string) => void;
};

export function ImportIdentityModal({ open, onClose, onImport }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const words = input.trim().split(/\s+/).filter(Boolean);
  const isValidFormat = words.length === 12;
  const isValidMnemonic = isValidFormat && validateMnemonic(input.trim());

  const handleImport = useCallback(() => {
    if (!isValidMnemonic) {
      setError(t("identity.invalidMnemonic"));
      return;
    }

    onImport(input.trim());
    setInput("");
    setError("");
    onClose();
  }, [input, isValidMnemonic, onClose, onImport, t]);

  return (
    <P5Modal
      open={open}
      onClose={onClose}
      title={t("importIdentityModal.title")}
      footer={
        <>
          <P5Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </P5Button>
          <P5Button
            variant="primary"
            onClick={handleImport}
            disabled={!isValidMnemonic}
          >
            {t("importIdentityModal.confirm")}
          </P5Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block font-display text-sm uppercase tracking-wide">
            {t("importIdentityModal.label")}
          </label>
          <P5Textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            placeholder={t("importIdentityModal.placeholder")}
            rows={4}
          />
        </div>

        {/* 验证状态 */}
        {input.trim() && (
          <div className="border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-3 text-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span>{isValidFormat ? "✓" : "✗"}</span>
                <span
                  className={
                    isValidFormat ? "" : "text-[color:var(--rebel-red)]"
                  }
                >
                  {isValidFormat
                    ? t("importIdentityModal.formatOk", { count: words.length })
                    : t("importIdentityModal.formatBad", { count: words.length })}
                </span>
              </div>
              {isValidFormat && (
                <div className="flex items-center gap-2">
                  <span>{isValidMnemonic ? "✓" : "✗"}</span>
                  <span
                    className={
                      isValidMnemonic ? "" : "text-[color:var(--rebel-red)]"
                    }
                  >
                    {isValidMnemonic
                      ? t("importIdentityModal.checksumOk")
                      : t("importIdentityModal.checksumBad")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-[color:var(--rebel-red)]">{error}</div>
        )}

        {/* 警告 */}
        <div className="border-[3px] border-[color:var(--rebel-red)] bg-[color:var(--paper)] p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠</span>
            <div>
              <p className="font-medium text-[color:var(--ink)]">
                {t("importIdentityModal.warningTitle")}
              </p>
              <p className="mt-1 text-[color:var(--ink)]/70">
                {t("importIdentityModal.warningBody")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </P5Modal>
  );
}
