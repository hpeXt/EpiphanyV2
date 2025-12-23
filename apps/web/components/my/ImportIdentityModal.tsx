"use client";

import { useCallback, useState } from "react";
import { P5Modal } from "@/components/ui/P5Modal";
import { P5Button } from "@/components/ui/P5Button";
import { P5Textarea } from "@/components/ui/P5Textarea";
import {
  validateMnemonic,
  mnemonicToMasterSeedHex,
  deriveTopicKeypairFromMasterSeedHex,
} from "@/lib/identity";

type Props = {
  open: boolean;
  onClose: () => void;
  onImport: (mnemonic: string) => void;
};

export function ImportIdentityModal({ open, onClose, onImport }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const words = input.trim().split(/\s+/).filter(Boolean);
  const isValidFormat = words.length === 12;
  const isValidMnemonic = isValidFormat && validateMnemonic(input.trim());

  // 预览地址
  const previewAddress = isValidMnemonic
    ? (() => {
        try {
          const seedHex = mnemonicToMasterSeedHex(input.trim());
          const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(
            seedHex,
            "preview"
          );
          return `${pubkeyHex.slice(0, 8)}...${pubkeyHex.slice(-8)}`;
        } catch {
          return null;
        }
      })()
    : null;

  const handleImport = useCallback(() => {
    if (!isValidMnemonic) {
      setError("无效的助记词");
      return;
    }

    onImport(input.trim());
    setInput("");
    setError("");
    onClose();
  }, [input, isValidMnemonic, onImport, onClose]);

  return (
    <P5Modal
      open={open}
      onClose={onClose}
      title="IMPORT IDENTITY"
      footer={
        <>
          <P5Button variant="ghost" onClick={onClose}>
            取消
          </P5Button>
          <P5Button
            variant="primary"
            onClick={handleImport}
            disabled={!isValidMnemonic}
          >
            导入身份
          </P5Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block font-display text-sm uppercase tracking-wide">
            输入 12 个助记词（用空格分隔）
          </label>
          <P5Textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            placeholder="apple banana cherry ..."
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
                  格式{isValidFormat ? "正确" : "错误"} ({words.length}/12 个词)
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
                    校验和{isValidMnemonic ? "有效" : "无效"}
                  </span>
                </div>
              )}
              {previewAddress && (
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span>派生地址:</span>
                  <span>{previewAddress}</span>
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
                导入将覆盖当前设备上的身份
              </p>
              <p className="mt-1 text-[color:var(--ink)]/70">
                当前身份的投票记录将无法访问（除非再次导入）
              </p>
            </div>
          </div>
        </div>
      </div>
    </P5Modal>
  );
}
