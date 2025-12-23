"use client";

import { useCallback, useEffect, useState } from "react";
import { P5Button } from "@/components/ui/P5Button";

type Props = {
  mnemonic: string;
};

export function MnemonicDisplay({ mnemonic }: Props) {
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
        <h3 className="font-display text-sm uppercase tracking-wide text-[color:var(--ink)]">
          助记词备份
        </h3>
        <div className="flex gap-2">
          <P5Button
            size="sm"
            variant="ghost"
            onClick={() => setIsRevealed(!isRevealed)}
          >
            {isRevealed ? "🙈 隐藏" : "👁 显示"}
          </P5Button>
          <P5Button
            size="sm"
            variant={copyStatus === "copied" ? "ink" : "ghost"}
            onClick={handleCopy}
            disabled={!isRevealed}
          >
            {copyStatus === "copied" ? "✓ 已复制" : "复制"}
          </P5Button>
        </div>
      </div>

      {/* 助记词卡片 */}
      <div
        className={`
          relative overflow-hidden
          border-[4px] border-[color:var(--ink)]
          transition-all duration-150
          ${
            isRevealed
              ? "bg-[color:var(--ink)] shadow-[var(--p5-shadow-md)]"
              : "bg-[color:var(--concrete-200)]"
          }
        `}
      >
        {isRevealed ? (
          // 明文显示
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {words.map((word, i) => (
              <div
                key={i}
                className="border-[2px] border-[color:var(--paper)] bg-[color:var(--ink)] px-2 py-1 text-center"
              >
                <span className="mr-1 font-mono text-xs text-[color:var(--paper)]/50">
                  {i + 1}.
                </span>
                <span className="font-mono text-sm text-[color:var(--paper)]">
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
                    className="h-2 w-2 rounded-full bg-[color:var(--ink)]/30"
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 自动隐藏倒计时（揭示时显示） */}
        {isRevealed && (
          <div className="border-t-[2px] border-[color:var(--paper)]/30 px-4 py-2 text-center text-xs text-[color:var(--paper)]/70">
            30 秒后自动隐藏
          </div>
        )}
      </div>

      {/* 警告提示 */}
      <div className="border-[3px] border-[color:var(--acid)] bg-[color:var(--paper)] p-3 text-sm">
        <div className="flex items-start gap-2">
          <span className="text-lg">⚠</span>
          <div>
            <p className="font-medium text-[color:var(--ink)]">
              助记词是恢复身份的唯一方式
            </p>
            <p className="mt-1 text-[color:var(--ink)]/70">
              清除浏览器数据或更换设备后，未备份将永久丢失
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
