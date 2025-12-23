"use client";

import { useCallback, useId, useMemo, useState } from "react";

type P5SliderProps = {
  /** 当前票数 (0-10) */
  value: number;
  /** 之前的票数（用于计算增量） */
  previousValue?: number;
  /** 当前余额 */
  balance: number;
  /** 值变化回调 */
  onChange: (value: number) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 最小值 (默认 0) */
  min?: number;
  /** 最大值 (默认 10) */
  max?: number;
  /** 仅允许减少（pruned 节点） */
  decreaseOnly?: boolean;
  /** 测试锚点 data-testid */
  "data-testid"?: string;
};

function calculateCost(votes: number): number {
  return votes * votes;
}

export function P5Slider({
  value,
  previousValue = 0,
  balance,
  onChange,
  disabled = false,
  min = 0,
  max = 10,
  decreaseOnly = false,
  "data-testid": testId,
}: P5SliderProps) {
  const id = useId();
  const [isDragging, setIsDragging] = useState(false);

  const currentCost = calculateCost(value);
  const previousCost = calculateCost(previousValue);
  const deltaCost = currentCost - previousCost;
  const newBalance = balance - deltaCost;
  const canAfford = newBalance >= 0;

  const effectiveMax = useMemo(() => {
    if (decreaseOnly) return previousValue;
    // 计算用户能承担的最大票数
    const maxAffordable = Math.floor(Math.sqrt(balance + previousCost));
    return Math.min(max, maxAffordable);
  }, [decreaseOnly, previousValue, balance, previousCost, max]);

  const effectiveMin = decreaseOnly ? 0 : min;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseInt(e.target.value, 10);
      if (newValue >= effectiveMin && newValue <= effectiveMax) {
        onChange(newValue);
      }
    },
    [onChange, effectiveMin, effectiveMax]
  );

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-4" data-testid={testId}>
      {/* 标签 */}
      <label
        htmlFor={id}
        className="block font-display text-sm uppercase tracking-wide text-[color:var(--ink)]"
      >
        投票数
      </label>

      {/* 滑块容器 */}
      <div className="relative pt-10">
        {/* 数值气泡 */}
        <div
          className="absolute top-0 -translate-x-1/2 border-2 border-[color:var(--paper)] bg-[color:var(--ink)] px-2 py-1 font-mono text-sm text-[color:var(--paper)]"
          style={{ left: `${percentage}%` }}
        >
          {value}
          {/* 三角指向 */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[color:var(--ink)]" />
        </div>

        {/* 刻度线 */}
        <div className="mb-2 flex justify-between px-3 font-mono text-xs text-[color:var(--ink)]/70">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(
            (tick) => (
              <span
                key={tick}
                className={
                  tick === value ? "font-bold text-[color:var(--rebel-red)]" : ""
                }
              >
                {tick}
              </span>
            )
          )}
        </div>

        {/* 轨道 */}
        <div className="relative h-3 border-[3px] border-[color:var(--ink)] bg-[color:var(--concrete-200)]">
          {/* 填充部分 */}
          <div
            className="absolute inset-y-0 left-0 bg-[color:var(--rebel-red)]"
            style={{ width: `${percentage}%` }}
          />

          {/* 原生 input（不可见，用于可访问性） */}
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={1}
            value={value}
            onChange={handleChange}
            disabled={disabled}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => setIsDragging(false)}
            onTouchStart={() => setIsDragging(true)}
            onTouchEnd={() => setIsDragging(false)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={`${value} 票，花费 ${currentCost} 分`}
            data-testid={testId ? `${testId}-input` : undefined}
          />

          {/* 自定义滑块 */}
          <div
            className={`
              absolute top-1/2 -translate-y-1/2
              h-7 w-7 -translate-x-1/2
              border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)]
              transition-all duration-[var(--p5-motion-micro)]
              ${
                isDragging
                  ? "shadow-[1px_1px_0_var(--ink)] scale-95"
                  : "shadow-[var(--p5-shadow-sm)] hover:scale-110 hover:shadow-[3px_3px_0_var(--rebel-red),5px_5px_0_var(--ink)]"
              }
              ${
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-grab active:cursor-grabbing"
              }
            `}
            style={{ left: `${percentage}%` }}
          />
        </div>
      </div>

      {/* 花费信息 */}
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-4">
          {/* 花费 */}
          <div className="border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] px-3 py-2 shadow-[var(--p5-shadow-sm)]">
            <div className="font-display text-xs uppercase tracking-wide text-[color:var(--ink)]/70">
              花费
            </div>
            <div
              className={`font-mono text-lg ${
                !canAfford ? "text-[color:var(--rebel-red)]" : ""
              }`}
            >
              {currentCost} 分
            </div>
            <div className="font-mono text-xs text-[color:var(--ink)]/50">
              ({value}² = {currentCost})
            </div>
          </div>

          {/* 变化 */}
          {previousValue !== value && (
            <div className="border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] px-3 py-2 shadow-[var(--p5-shadow-sm)]">
              <div className="font-display text-xs uppercase tracking-wide text-[color:var(--ink)]/70">
                变化
              </div>
              <div
                className={`font-mono text-lg ${
                  deltaCost > 0
                    ? "text-[color:var(--rebel-red)]"
                    : "text-[color:var(--electric)]"
                }`}
              >
                {deltaCost > 0 ? `+${deltaCost}` : deltaCost} 分
              </div>
            </div>
          )}
        </div>

        {/* 余额预览 */}
        <div className="flex items-center gap-2 font-mono">
          <span className="text-[color:var(--ink)]/70">◆ {balance}</span>
          <span className="text-[color:var(--ink)]/50">→</span>
          <span
            className={
              !canAfford
                ? "font-bold text-[color:var(--rebel-red)]"
                : "text-[color:var(--ink)]"
            }
          >
            ◆ {newBalance}
          </span>
        </div>
      </div>

      {/* 余额不足警告 */}
      {!canAfford && (
        <div
          className="animate-shake border-[4px] border-[color:var(--rebel-red)] bg-[color:var(--paper)] p-3 text-sm text-[color:var(--rebel-red)]"
          role="alert"
        >
          ⚠ 余额不足！需要 {deltaCost} 分，当前余额 {balance} 分
        </div>
      )}

      {/* Decrease Only 提示 */}
      {decreaseOnly && (
        <div className="border-[3px] border-[color:var(--acid)] bg-[color:var(--paper)] p-2 text-sm text-[color:var(--ink)]">
          ⚠ 此节点已被修剪，仅允许减少投票
        </div>
      )}
    </div>
  );
}
