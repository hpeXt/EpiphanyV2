"use client";

import { useCallback, useEffect, useState } from "react";
import { P5Button } from "@/components/ui/P5Button";
import { P5Alert } from "@/components/ui/P5Alert";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  mnemonic: string;
};

export function MnemonicDisplay({ mnemonic }: Props) {
  const { t } = useI18n();
  const [isRevealed, setIsRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const words = mnemonic.split(" ");

  // 30 秒自动隐藏
  useEffect(() => {
    if (!isRevealed) return;

    const timer = setTimeout(() => {
      setIsRevealed(false);
    }, 30000);

    return () => clearTimeout(timer);
  }, [isRevealed]);

  // 复制功能
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopyStatus("copied");

      // 2 秒后恢复按钮状态
      setTimeout(() => setCopyStatus("idle"), 2000);

      // 30 秒后清除剪贴板
      setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === mnemonic) {
            await navigator.clipboard.writeText("");
          }
        } catch {
          // 忽略权限错误
        }
      }, 30000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }, [mnemonic]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-foreground">{t("mnemonic.title")}</h3>
        <div className="flex gap-2">
          <P5Button
            size="sm"
            variant="ghost"
            onClick={() => setIsRevealed(!isRevealed)}
          >
            {isRevealed ? `🙈 ${t("common.hide")}` : `👁 ${t("common.show")}`}
          </P5Button>
          <P5Button
            size="sm"
            variant={copyStatus === "copied" ? "ink" : "ghost"}
            onClick={handleCopy}
            disabled={!isRevealed}
          >
            {copyStatus === "copied" ? `✓ ${t("mnemonic.copied")}` : t("mnemonic.copy")}
          </P5Button>
        </div>
      </div>

      {/* 助记词卡片 */}
      <div
        className={`
          relative overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm
        `}
      >
        {isRevealed ? (
          // 明文显示
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {words.map((word, i) => (
              <div
                key={i}
                className="rounded-md border border-border bg-background px-2 py-1 text-center"
              >
                <span className="mr-1 font-mono text-xs text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="font-mono text-sm text-foreground">
                  {word}
                </span>
              </div>
            ))}
          </div>
        ) : (
          // 遮罩显示
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {words.map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-center gap-1 px-2 py-1"
              >
                {Array.from({ length: 4 }, (_, j) => (
                  <span
                    key={j}
                    className="h-2 w-2 rounded-full bg-muted-foreground/30"
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 自动隐藏倒计时（揭示时显示） */}
        {isRevealed && (
          <div className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">
            {t("mnemonic.autoHide", { seconds: 30 })}
          </div>
        )}
      </div>

      {/* 警告提示 */}
      <P5Alert variant="warn" title={t("mnemonic.alertTitle")} role="status">
        <div className="space-y-1">
          <p className="font-medium">{t("mnemonic.alertLine1")}</p>
          <p className="text-muted-foreground">
            {t("mnemonic.alertLine2")}
          </p>
        </div>
      </P5Alert>
    </div>
  );
}
