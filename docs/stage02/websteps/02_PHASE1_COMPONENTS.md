# Phase 1: 核心组件

> P5Slider、P5Modal、P5Skeleton 实现

## 1.1 P5Slider (投票核心组件)

### 目标
实现 `UX_UI_PLAN.md` 3.4.2 节定义的 P5 风格投票滑块

### 功能需求
- 0-10 离散刻度
- 实时显示当前票数、花费 (cost = votes²)、余额变化
- P5 视觉风格：粗轨道、方形滑块、偏移投影
- 悬停/拖动状态反馈

### 实施步骤

#### Step 1.1.1: 创建组件文件

创建 `apps/web/components/ui/P5Slider.tsx`:

```tsx
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
    <div className="space-y-4">
      {/* 标签 */}
      <label
        htmlFor={id}
        className="block font-display text-sm uppercase tracking-wide text-[color:var(--ink)]"
      >
        投票数
      </label>

      {/* 滑块容器 */}
      <div className="relative">
        {/* 刻度线 */}
        <div className="mb-2 flex justify-between px-3 font-mono text-xs text-[color:var(--ink)]/70">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((tick) => (
            <span
              key={tick}
              className={tick === value ? "font-bold text-[color:var(--rebel-red)]" : ""}
            >
              {tick}
            </span>
          ))}
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
          />

          {/* 自定义滑块 */}
          <div
            className={`
              absolute top-1/2 -translate-y-1/2
              h-7 w-7 -translate-x-1/2
              border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)]
              transition-all duration-[var(--p5-motion-micro)]
              ${isDragging
                ? "shadow-[1px_1px_0_var(--ink)] scale-95"
                : "shadow-[var(--p5-shadow-sm)] hover:scale-110 hover:shadow-[3px_3px_0_var(--rebel-red),5px_5px_0_var(--ink)]"
              }
              ${disabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing"}
            `}
            style={{ left: `${percentage}%` }}
          />
        </div>

        {/* 数值气泡 */}
        <div
          className="absolute -top-10 -translate-x-1/2 border-2 border-[color:var(--paper)] bg-[color:var(--ink)] px-2 py-1 font-mono text-sm text-[color:var(--paper)]"
          style={{ left: `${percentage}%` }}
        >
          {value}
          {/* 三角指向 */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[color:var(--ink)]" />
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
            <div className={`font-mono text-lg ${!canAfford ? "text-[color:var(--rebel-red)]" : ""}`}>
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
              <div className={`font-mono text-lg ${deltaCost > 0 ? "text-[color:var(--rebel-red)]" : "text-[color:var(--electric)]"}`}>
                {deltaCost > 0 ? `+${deltaCost}` : deltaCost} 分
              </div>
            </div>
          )}
        </div>

        {/* 余额预览 */}
        <div className="flex items-center gap-2 font-mono">
          <span className="text-[color:var(--ink)]/70">◆ {balance}</span>
          <span className="text-[color:var(--ink)]/50">→</span>
          <span className={!canAfford ? "text-[color:var(--rebel-red)] font-bold" : "text-[color:var(--ink)]"}>
            ◆ {newBalance}
          </span>
        </div>
      </div>

      {/* 余额不足警告 */}
      {!canAfford && (
        <div className="animate-shake border-[4px] border-[color:var(--rebel-red)] bg-[color:var(--paper)] p-3 text-sm text-[color:var(--rebel-red)]">
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
```

#### Step 1.1.2: 导出组件

在 `apps/web/components/ui/index.ts`（如不存在则创建）添加：

```tsx
export { P5Slider } from "./P5Slider";
```

---

## 1.2 P5Modal (统一弹窗)

### 目标
实现 `UX_UI_PLAN.md` 8.3 节定义的 P5 风格模态框

### 功能需求
- 遮罩层 + 内容卡片
- 标题栏支持 default/danger/success 变体
- 入场动画 (scale + opacity)
- ESC 关闭、点击遮罩关闭（可配置）
- focus trap

### 实施步骤

#### Step 1.2.1: 创建组件文件

创建 `apps/web/components/ui/P5Modal.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Variant = "default" | "danger" | "success";

type P5ModalProps = {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title: string;
  /** 变体 */
  variant?: Variant;
  /** 内容 */
  children: ReactNode;
  /** Footer（通常是按钮组） */
  footer?: ReactNode;
  /** 点击遮罩关闭 */
  closeOnOverlayClick?: boolean;
  /** 最大宽度 */
  maxWidth?: string;
};

const HEADER_VARIANT: Record<Variant, string> = {
  default: "bg-[color:var(--ink)] text-[color:var(--paper)]",
  danger: "bg-[color:var(--rebel-red)] text-[color:var(--paper)]",
  success: "bg-[color:var(--acid)] text-[color:var(--ink)]",
};

export function P5Modal({
  open,
  onClose,
  title,
  variant = "default",
  children,
  footer,
  closeOnOverlayClick = true,
  maxWidth = "560px",
}: P5ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    previousActiveElement.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();

    return () => {
      previousActiveElement.current?.focus();
    };
  }, [open]);

  // 禁止背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlayClick && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      {/* 内容卡片 */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="
          relative w-full animate-pop
          border-[6px] border-[color:var(--ink)] bg-[color:var(--paper)]
          shadow-[var(--p5-shadow-xl)]
          focus:outline-none
        "
        style={{ maxWidth }}
      >
        {/* 标题栏 */}
        <div
          className={`
            flex items-center justify-between px-5 py-3
            font-display text-lg uppercase tracking-wide
            ${HEADER_VARIANT[variant]}
          `}
        >
          <h2 id="modal-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="
              flex h-8 w-8 items-center justify-center
              border-[3px] border-current bg-transparent
              text-current transition-transform
              hover:scale-110 hover:bg-current/10
              focus:outline-none focus:ring-2 focus:ring-current
            "
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t-[3px] border-[color:var(--ink)] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  // Portal 到 body
  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}
```

---

## 1.3 P5Skeleton (加载骨架)

### 目标
实现 `UX_UI_PLAN.md` 8.6 节定义的 P5 风格加载骨架

### 实施步骤

#### Step 1.3.1: 创建组件文件

创建 `apps/web/components/ui/P5Skeleton.tsx`:

```tsx
type Variant = "text" | "title" | "card" | "avatar" | "button";

type P5SkeletonProps = {
  variant?: Variant;
  className?: string;
  /** 重复数量 */
  count?: number;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  text: "h-4 w-full",
  title: "h-8 w-3/5",
  card: "h-32 w-full",
  avatar: "h-10 w-10 rounded-full",
  button: "h-10 w-24",
};

export function P5Skeleton({
  variant = "text",
  className = "",
  count = 1,
}: P5SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  return (
    <>
      {items.map((i) => (
        <div
          key={i}
          className={`
            texture-stripes
            animate-[p5-skeleton-pulse_1.5s_ease-in-out_infinite]
            border-[4px] border-[color:var(--ink)]
            ${VARIANT_CLASSES[variant]}
            ${className}
          `}
          role="status"
          aria-label="加载中"
        />
      ))}
    </>
  );
}

/** 组合骨架：卡片内容 */
export function P5SkeletonCard() {
  return (
    <div className="space-y-3 border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)] p-4 shadow-[var(--p5-shadow-md)]">
      <P5Skeleton variant="title" />
      <P5Skeleton variant="text" />
      <P5Skeleton variant="text" className="w-4/5" />
      <div className="flex items-center gap-2 pt-2">
        <P5Skeleton variant="avatar" />
        <P5Skeleton variant="text" className="w-24" />
      </div>
    </div>
  );
}

/** 组合骨架：列表 */
export function P5SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <P5SkeletonCard key={i} />
      ))}
    </div>
  );
}
```

---

## 1.4 验收清单

- [ ] P5Slider
  - [ ] 滑块拖动流畅
  - [ ] 刻度线显示正确
  - [ ] 数值气泡跟随滑块
  - [ ] 花费实时计算 (votes²)
  - [ ] 余额变化显示
  - [ ] 余额不足时 shake 警告
  - [ ] decreaseOnly 模式限制加票
  - [ ] disabled 状态可用

- [ ] P5Modal
  - [ ] 打开时有 pop 动画
  - [ ] ESC 可关闭
  - [ ] 点击遮罩可关闭（默认）
  - [ ] focus trap 工作
  - [ ] 背景滚动禁止
  - [ ] danger/success 变体样式正确

- [ ] P5Skeleton
  - [ ] 条纹纹理显示
  - [ ] 脉冲动画播放
  - [ ] 各 variant 尺寸正确
  - [ ] count 重复工作

---

## 预计产出文件

```
apps/web/components/ui/
├── P5Slider.tsx     # 新增
├── P5Modal.tsx      # 新增
├── P5Skeleton.tsx   # 新增
└── index.ts         # 新增/修改
```
