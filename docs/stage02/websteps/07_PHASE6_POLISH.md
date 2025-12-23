# Phase 6: 收口与验收

> 可视化提升、错误处理统一、最终验收

## 6.1 可视化提升

### 6.1.1 FocusView 优化

#### 目标
确保 FocusView 符合 `UX_UI_PLAN.md` 6.1 节规范

#### 检查清单
- [ ] 直角折线连接（**严禁曲线**）
- [ ] 节点左侧 stance 色条 (4px)
- [ ] 选中态双层阴影 (RebelRed + Ink)
- [ ] 高亮路径（从根到选中节点）
- [ ] 展开/收起动画

#### 实施要点

修改 `apps/web/components/topics/FocusView.tsx`:

```tsx
// 连接线样式
const connectionStyle = {
  stroke: "var(--ink)",
  strokeWidth: 3,
  fill: "none",
  // 直角折线路径
  d: `M ${parentX} ${parentY} L ${parentX} ${midY} L ${childX} ${midY} L ${childX} ${childY}`,
};

// 高亮路径
const highlightedStyle = {
  stroke: "var(--rebel-red)",
  strokeWidth: 4,
};

// 节点卡片
<div
  className={`
    relative
    border-[4px] border-[color:var(--ink)]
    ${isSelected
      ? "shadow-[4px_4px_0_var(--rebel-red),8px_8px_0_var(--ink)] scale-[1.02]"
      : "shadow-[var(--p5-shadow-md)]"
    }
  `}
>
  {/* Stance 色条 */}
  <div
    className="absolute left-0 top-0 bottom-0 w-1"
    style={{ backgroundColor: stanceColor }}
  />
  {/* 内容 */}
</div>
```

### 6.1.2 GodView 优化

#### 目标
确保 GodView 符合 `UX_UI_PLAN.md` 6.2 节规范

#### 检查清单
- [ ] 节点大小 ∝ totalVotes（sqrt 缩放）
- [ ] 节点描边 = stance 色
- [ ] 集群区域虚线边框
- [ ] 集群标签 (Calling Card 风格)
- [ ] Legend 图例
- [ ] Hover Calling Card

#### 实施要点

修改 `apps/web/components/topics/GodView.tsx`:

```tsx
// 节点渲染配置
const nodeConfig = {
  minRadius: 8,
  maxRadius: 32,
  radiusScale: d3.scaleSqrt().domain([0, maxVotes]).range([8, 32]),
  stanceColors: {
    pro: "var(--electric)",
    con: "var(--rebel-red)",
    neutral: "var(--acid)",
  },
};

// 集群区域
const clusterConfig = {
  fillOpacity: 0.1,
  stroke: "var(--ink)",
  strokeDasharray: "8 4",
  strokeWidth: 2,
};

// Legend
<div className="absolute bottom-4 left-4 border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-3">
  <div className="text-xs font-display uppercase">Legend</div>
  <div className="mt-2 flex flex-col gap-1 text-xs">
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full border-2 border-[color:var(--electric)]" />
      <span>Pro</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full border-2 border-[color:var(--rebel-red)]" />
      <span>Con</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full border-2 border-[color:var(--acid)]" />
      <span>Neutral</span>
    </div>
  </div>
</div>
```

### 6.1.3 SunburstView 优化

#### 目标
确保 SunburstView 符合 `UX_UI_PLAN.md` 6.3 节规范

#### 检查清单
- [ ] 扇区 stance 色填充
- [ ] 统一 Ink 描边 (2px)
- [ ] 选中态双层描边 (4px RebelRed + 8px Ink)
- [ ] 选中态贴纸标签
- [ ] Hover Calling Card

---

## 6.2 错误处理统一

### 目标
实现 `UX_UI_PLAN.md` 9.1 节定义的错误码 UI 映射

### 6.2.1 创建错误处理 Hook

创建 `apps/web/hooks/useApiError.ts`:

```tsx
"use client";

import { useCallback } from "react";
import { useP5Toast } from "@/components/ui/P5ToastProvider";

type ApiError = {
  code: string;
  message: string;
  status?: number;
};

export function useApiError() {
  const { toast } = useP5Toast();

  const handleError = useCallback(
    (error: ApiError) => {
      const { code, message, status } = error;

      // 映射错误到 UI
      switch (code) {
        case "INSUFFICIENT_BALANCE":
          toast({
            variant: "error",
            title: "余额不足",
            message: "你需要先撤回其他节点的投票来释放积分",
            action: {
              label: "前往「我的」",
              href: "/my",
            },
          });
          break;

        case "INVALID_SIGNATURE":
          toast({
            variant: "error",
            title: "签名无效",
            message: "请刷新页面或重新设置身份",
            action: {
              label: "刷新",
              onClick: () => window.location.reload(),
            },
          });
          break;

        case "TIMESTAMP_OUT_OF_RANGE":
          toast({
            variant: "error",
            title: "时间戳错误",
            message: "请检查设备时间是否正确",
          });
          break;

        case "NONCE_REPLAY":
          toast({
            variant: "info",
            title: "操作已完成",
            message: "这个操作已经执行过了",
          });
          break;

        case "TOPIC_STATUS_DISALLOWS_WRITE":
          toast({
            variant: "warn",
            title: "议题已冻结",
            message: "当前只能撤回投票，不能新增",
          });
          break;

        case "ARGUMENT_PRUNED_INCREASE_FORBIDDEN":
          toast({
            variant: "warn",
            title: "节点已修剪",
            message: "只能减少投票，不能增加",
          });
          break;

        case "RATE_LIMITED":
          toast({
            variant: "warn",
            title: "请求过于频繁",
            message: "请稍后再试",
          });
          break;

        case "TOPIC_PUBKEY_BLACKLISTED":
          toast({
            variant: "error",
            title: "无法写入",
            message: "你在此议题被禁用写入权限",
          });
          break;

        default:
          toast({
            variant: "error",
            title: "错误",
            message: message || "发生未知错误",
          });
      }
    },
    [toast]
  );

  return { handleError };
}
```

### 6.2.2 更新 Toast 支持 Action

修改 `apps/web/components/ui/P5ToastProvider.tsx`:

```tsx
type ToastAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

type Toast = {
  // ... 现有字段
  action?: ToastAction;
};

// 在 Toast 组件中渲染 action
{toast.action && (
  toast.action.href ? (
    <Link
      href={toast.action.href}
      className="mt-2 inline-block border-[2px] border-current px-2 py-1 text-xs hover:bg-current/10"
    >
      {toast.action.label}
    </Link>
  ) : (
    <button
      onClick={toast.action.onClick}
      className="mt-2 border-[2px] border-current px-2 py-1 text-xs hover:bg-current/10"
    >
      {toast.action.label}
    </button>
  )
)}
```

---

## 6.3 Topic 状态 UI 映射

### 目标
确保 Topic 状态在 UI 上清晰可见

### 6.3.1 状态指示器

```tsx
const STATUS_CONFIG = {
  active: {
    badge: "acid",
    label: "ACTIVE",
    writeAllowed: true,
    message: null,
  },
  frozen: {
    badge: "electric",
    label: "FROZEN",
    writeAllowed: false,
    message: "议题已冻结，只能撤回投票",
  },
  archived: {
    badge: "ink",
    label: "ARCHIVED",
    writeAllowed: false,
    message: "议题已归档，只读模式",
  },
};
```

### 6.3.2 写入区域遮罩

在 DialogueStream 中：

```tsx
{topicStatus !== "active" && (
  <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--concrete-200)]/80">
    <div className="border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)] p-4 text-center">
      <div className="font-display text-lg uppercase">
        {STATUS_CONFIG[topicStatus].label}
      </div>
      <div className="mt-2 text-sm">
        {STATUS_CONFIG[topicStatus].message}
      </div>
    </div>
  </div>
)}
```

---

## 6.4 空态设计

### 目标
所有列表/容器都有引导性空态

### 6.4.1 通用空态组件

创建 `apps/web/components/ui/P5EmptyState.tsx`:

```tsx
type Props = {
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  icon?: string;
};

export function P5EmptyState({ title, description, action, icon = "○" }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 text-4xl text-[color:var(--ink)]/30">{icon}</div>
      <div className="font-display text-lg uppercase text-[color:var(--ink)]">
        {title}
      </div>
      {description && (
        <div className="mt-2 text-sm text-[color:var(--ink)]/70">
          {description}
        </div>
      )}
      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="mt-4 border-[4px] border-[color:var(--ink)] bg-[color:var(--rebel-red)] px-4 py-2 font-display uppercase text-[color:var(--paper)] shadow-[var(--p5-shadow-md)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
          >
            {action.label}
          </Link>
        ) : (
          <button
            onClick={action.onClick}
            className="mt-4 border-[4px] border-[color:var(--ink)] bg-[color:var(--rebel-red)] px-4 py-2 font-display uppercase text-[color:var(--paper)] shadow-[var(--p5-shadow-md)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
```

### 6.4.2 使用场景

```tsx
// 无子节点
<P5EmptyState
  title="暂无回复"
  description="成为第一个发表观点的人"
  icon="💬"
/>

// 无搜索结果
<P5EmptyState
  title="无匹配结果"
  description="尝试调整搜索条件"
  icon="🔍"
/>

// My 页面无记录
<P5EmptyState
  title="暂无参与记录"
  description="去参与议题讨论吧"
  action={{ label: "浏览议题", href: "/" }}
  icon="📭"
/>
```

---

## 6.5 可访问性检查

### 6.5.1 检查清单

- [ ] **键盘可访问**
  - [ ] 所有交互元素可 Tab 到达
  - [ ] 按钮/链接可 Enter 激活
  - [ ] Modal 有 focus trap
  - [ ] ESC 可关闭 Modal

- [ ] **色彩对比度**
  - [ ] 文字/背景对比 ≥ 4.5:1
  - [ ] 交互元素边界清晰
  - [ ] 不仅靠颜色传达信息

- [ ] **动画**
  - [ ] `prefers-reduced-motion` 时禁用
  - [ ] 无闪烁动画

- [ ] **语义**
  - [ ] 表单有 label 关联
  - [ ] 错误有 `role="alert"`
  - [ ] 加载有 `role="status"`
  - [ ] 图像有 alt

### 6.5.2 测试工具

```bash
# 安装 axe-core
pnpm -C apps/web add -D @axe-core/react

# 在开发环境启用
if (process.env.NODE_ENV === 'development') {
  import('@axe-core/react').then(axe => {
    axe.default(React, ReactDOM, 1000);
  });
}
```

---

## 6.6 性能优化

### 6.6.1 检查清单

- [ ] **字体加载**
  - [ ] 使用 `next/font` 子集化
  - [ ] `display: swap`

- [ ] **图片**
  - [ ] 使用 `next/image`
  - [ ] 适当的 sizes/priority

- [ ] **可视化**
  - [ ] D3 使用 Canvas（大数据量时）
  - [ ] 虚拟滚动（长列表）

- [ ] **Bundle**
  - [ ] 动态导入大组件
  - [ ] Tree shaking

### 6.6.2 实施

```tsx
// 动态导入 D3 可视化
const GodView = dynamic(() => import("@/components/topics/GodView"), {
  loading: () => <P5Skeleton variant="card" />,
  ssr: false,
});
```

---

## 6.7 最终验收清单

### 功能不回归（来自 PROJECT_REFERENCE.md）

- [ ] 签名 v1 规范不改坏
- [ ] `setVotes` 强幂等 + 允许撤回
- [ ] SSE `reload_required(trimmed)` 可恢复
- [ ] `role="alert"` 语义保留
- [ ] Reply textarea、Votes slider 测试锚点保留

### 视觉一致性

- [ ] 所有按钮使用 P5Button
- [ ] 所有卡片使用 P5Card/P5Panel
- [ ] 所有弹窗使用 P5Modal
- [ ] 所有提示使用 P5Alert
- [ ] 颜色仅引用 CSS 变量
- [ ] 边框宽度统一 4px
- [ ] 阴影偏移统一 4px 4px 0

### 交互体验

- [ ] 所有按钮有 hover/active/focus 状态
- [ ] 所有输入框有 focus 状态
- [ ] 错误有 shake 动画
- [ ] 加载使用 P5Skeleton
- [ ] 空态有引导

### 回归测试流程

```bash
# 1. 运行自动化测试
pnpm -C apps/web test

# 2. 手动回归
# - 创建 topic → 检查表单样式
# - 进入 topic → 检查双栏布局
# - 切换 ViewMode → 检查 tabs 样式
# - 选中节点 → 检查 Calling Card
# - 投票 → 检查 Slider + 确认动画
# - 发言 → 检查 TipTap 编辑器
# - 错误触发 → 检查 Alert 样式
# - My 页面 → 检查身份区域
# - SSE 触发 → 检查 reload banner
```

---

## 预计产出文件

```
apps/web/
├── components/
│   ├── ui/
│   │   ├── P5EmptyState.tsx        # 新增
│   │   └── P5ToastProvider.tsx     # 修改（action 支持）
│   └── topics/
│       ├── FocusView.tsx           # 修改（优化）
│       ├── GodView.tsx             # 修改（优化）
│       └── SunburstView.tsx        # 修改（优化）
└── hooks/
    └── useApiError.ts              # 新增
```
