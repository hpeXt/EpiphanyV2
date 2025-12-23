# Phase 5: 动效系统

> 仪式感交互、投票确认动效、错误反馈

## 5.1 概述

### 目标
实现 `UX_UI_PLAN.md` 第十部分定义的动效系统，为关键交互添加「仪式感」

### 核心动效
| 场景 | 动效 | 时长 |
|-----|------|-----|
| 投票成功 | Stamp（印章盖下） | 300ms |
| 错误/警告 | Shake（短促震动） | 300ms |
| Modal/Tooltip 出现 | Pop（弹入） | 120ms |
| 面板滑出 | Slide | 200ms |
| 数值变化 | Pulse（脉冲） | 200ms |

---

## 5.2 投票成功动效 (Stamp)

### 目标
投票提交成功时，显示「印章盖下」的满足感

### 实施步骤

#### Step 5.2.1: 创建 VoteStamp 组件

创建 `apps/web/components/ui/VoteStamp.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Props = {
  show: boolean;
  votes: number;
  onComplete?: () => void;
};

export function VoteStamp({ show, votes, onComplete }: Props) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!isVisible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      {/* 全屏闪烁 */}
      <div
        className="absolute inset-0 bg-[color:var(--rebel-red)]"
        style={{
          animation: "flash 100ms ease-out forwards",
        }}
      />

      {/* 印章图标 */}
      <div
        className="
          relative
          border-[6px] border-[color:var(--ink)] bg-[color:var(--acid)]
          px-8 py-4
          shadow-[var(--p5-shadow-xl)]
        "
        style={{
          animation: "p5-stamp 300ms var(--p5-ease-bounce) forwards",
        }}
      >
        <div className="text-center">
          <div className="font-display text-4xl uppercase tracking-wider text-[color:var(--ink)]">
            ✓ VOTED
          </div>
          <div className="mt-1 font-mono text-xl text-[color:var(--ink)]">
            +{votes} 票
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes flash {
          0% { opacity: 0.15; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
```

#### Step 5.2.2: 在 DialogueStream 中使用

修改 `apps/web/components/topics/DialogueStream.tsx`：

```tsx
import { VoteStamp } from "@/components/ui/VoteStamp";

// 在组件内添加状态
const [showVoteStamp, setShowVoteStamp] = useState(false);
const [stampVotes, setStampVotes] = useState(0);

// 投票成功后触发
async function handleVote() {
  const result = await apiClient.setVotes(...);
  if (result.ok) {
    setStampVotes(newVotes);
    setShowVoteStamp(true);
    // ... 其他逻辑
  }
}

// 在 JSX 中添加
<VoteStamp
  show={showVoteStamp}
  votes={stampVotes}
  onComplete={() => setShowVoteStamp(false)}
/>
```

---

## 5.3 数值更新动效 (Pulse + Counter)

### 目标
余额、票数变化时有视觉反馈

### 实施步骤

#### Step 5.3.1: 创建 AnimatedNumber 组件

创建 `apps/web/components/ui/AnimatedNumber.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
};

export function AnimatedNumber({
  value,
  duration = 300,
  className = "",
  prefix = "",
  suffix = "",
}: Props) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current === value) return;

    setIsAnimating(true);
    const startValue = prevValue.current;
    const diff = value - startValue;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.round(startValue + diff * easedProgress);

      setDisplayValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        prevValue.current = value;
      }
    };

    requestAnimationFrame(animate);

    return () => {
      prevValue.current = value;
    };
  }, [value, duration]);

  return (
    <span
      className={`
        inline-block transition-transform
        ${isAnimating ? "animate-pulse scale-105" : ""}
        ${className}
      `}
    >
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
}
```

#### Step 5.3.2: 在余额显示中使用

修改 TopBar 或相关组件：

```tsx
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";

// 替换静态数字
<AnimatedNumber value={balance} prefix="◆ " className="font-mono" />
```

---

## 5.4 错误反馈动效 (Shake)

### 目标
错误发生时提供明确的视觉反馈

### 实施步骤

#### Step 5.4.1: 创建 useShake Hook

创建 `apps/web/hooks/useShake.ts`:

```tsx
"use client";

import { useCallback, useState } from "react";

export function useShake() {
  const [isShaking, setIsShaking] = useState(false);

  const shake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 300);
  }, []);

  const shakeClass = isShaking ? "animate-shake" : "";

  return { shake, shakeClass, isShaking };
}
```

#### Step 5.4.2: 在表单/按钮中使用

```tsx
import { useShake } from "@/hooks/useShake";

function VoteForm() {
  const { shake, shakeClass } = useShake();

  async function handleSubmit() {
    const result = await apiClient.setVotes(...);
    if (!result.ok) {
      shake(); // 触发震动
      // 显示错误
    }
  }

  return (
    <div className={shakeClass}>
      {/* 表单内容 */}
      <P5Button onClick={handleSubmit}>提交</P5Button>
    </div>
  );
}
```

---

## 5.5 按钮打击感

### 目标
按钮点击时有「下压」感

### 实施步骤

#### Step 5.5.1: 确认 P5Button 已有 active 状态

检查 `P5Button.tsx` 是否包含：

```css
active:translate-x-0.5 active:translate-y-0.5
```

如果没有，添加到 BASE 样式中。

#### Step 5.5.2: 添加阴影归零效果

```tsx
const BASE = `
  ...
  active:translate-x-0.5 active:translate-y-0.5
  active:shadow-none
`;
```

---

## 5.6 Tooltip Pop 动效

### 目标
Tooltip/Calling Card 出现时有弹入感

### 实施步骤

#### Step 5.6.1: 确认 animate-pop 类可用

检查 `globals.css` 是否包含：

```css
.animate-pop {
  animation: p5-pop var(--p5-motion-normal) var(--p5-ease-snap) forwards;
}
```

#### Step 5.6.2: 在 CallingCard 中使用

修改 `CallingCard.tsx`：

```tsx
export function CallingCard({ ... }) {
  return (
    <div className="animate-pop ...">
      {/* 内容 */}
    </div>
  );
}
```

---

## 5.7 面板滑入动效

### 目标
侧边面板、管理面板滑入显示

### 实施步骤

#### Step 5.7.1: 创建 SlidePanel 组件

创建 `apps/web/components/ui/SlidePanel.tsx`:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  position?: "right" | "left";
};

export function SlidePanel({
  open,
  onClose,
  title,
  children,
  position = "right",
}: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => setIsVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!isVisible) return null;

  const translateClass = position === "right"
    ? isAnimating ? "translate-x-0" : "translate-x-full"
    : isAnimating ? "translate-x-0" : "-translate-x-full";

  const positionClass = position === "right" ? "right-0" : "left-0";

  return (
    <div className="fixed inset-0 z-40">
      {/* 遮罩 */}
      <div
        className={`
          absolute inset-0 bg-black/50 transition-opacity duration-200
          ${isAnimating ? "opacity-100" : "opacity-0"}
        `}
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        className={`
          absolute top-0 ${positionClass} bottom-0 w-full max-w-md
          border-l-[4px] border-[color:var(--ink)] bg-[color:var(--paper)]
          shadow-[-8px_0_0_var(--ink)]
          transition-transform duration-200 ease-out
          ${translateClass}
        `}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4 py-3">
          <h2 className="font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center border-[3px] border-[color:var(--paper)] text-[color:var(--paper)] hover:bg-[color:var(--paper)]/10"
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="h-[calc(100%-56px)] overflow-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
```

---

## 5.8 首页扇区生长动效

### 目标
首页旭日图扇区逐个「生长」出来

### 实施
已在 Phase 3 的 `TopicUniverse.tsx` 中实现：

```typescript
paths
  .attr("transform", "scale(0)")
  .attr("opacity", 0)
  .transition()
  .duration(300)
  .delay((_, i) => i * 50)
  .attr("transform", "scale(1)")
  .attr("opacity", 1);
```

---

## 5.9 Reduced Motion 支持

### 目标
尊重用户的减少动画偏好

### 实施步骤

#### Step 5.9.1: 确认 CSS 规则存在

检查 `globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

#### Step 5.9.2: 创建 Hook 检测偏好

创建 `apps/web/hooks/usePrefersReducedMotion.ts`:

```tsx
"use client";

import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}
```

#### Step 5.9.3: 在 D3 动画中使用

```tsx
const prefersReducedMotion = usePrefersReducedMotion();

// D3 动画
paths
  .transition()
  .duration(prefersReducedMotion ? 0 : 300)
  // ...
```

---

## 5.10 验收清单

- [ ] VoteStamp
  - [ ] 投票成功时显示
  - [ ] 印章盖下动画
  - [ ] 全屏红色闪烁
  - [ ] 自动消失

- [ ] AnimatedNumber
  - [ ] 数值变化时滚动
  - [ ] 脉冲效果

- [ ] Shake
  - [ ] 错误时触发
  - [ ] 短促震动

- [ ] 按钮打击感
  - [ ] 点击时下压
  - [ ] 阴影归零

- [ ] SlidePanel
  - [ ] 滑入动画
  - [ ] 遮罩渐显

- [ ] Reduced Motion
  - [ ] CSS 规则生效
  - [ ] JS 动画跳过

---

## 预计产出文件

```
apps/web/
├── components/
│   └── ui/
│       ├── VoteStamp.tsx        # 新增
│       ├── AnimatedNumber.tsx   # 新增
│       ├── SlidePanel.tsx       # 新增
│       └── P5Button.tsx         # 修改（确认 active 状态）
├── hooks/
│   ├── useShake.ts              # 新增
│   └── usePrefersReducedMotion.ts # 新增
└── app/
    └── globals.css              # 确认动效 keyframes
```
