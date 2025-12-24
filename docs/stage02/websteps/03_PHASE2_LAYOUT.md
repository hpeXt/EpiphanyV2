# Phase 2: 页面架构

> Topic 双栏布局、TopBar 改造、列表页简化

## 2.1 Topic 详情页双栏布局

### 目标
将 `TopicPage.tsx` 从单栏改为 `UX_UI_PLAN.md` 2.5 节定义的双栏布局

### 当前状态
```
┌─────────────────────────────────────┐
│ P5Panel (Header)                    │
├─────────────────────────────────────┤
│ grid lg:grid-cols-[1fr_1.25fr]      │
│ ┌───────────────┬───────────────────┤
│ │ FocusView     │ DialogueStream    │
│ └───────────────┴───────────────────┘
└─────────────────────────────────────┘
```

### 目标状态
```
┌─────────────────────────────────────────────────────────────┐
│ TopBar (Topic 专用，56px)                                    │
├────────────────────────────┬────────────────────────────────┤
│                            │                                │
│   LEFT (60%)               │   RIGHT (40%)                  │
│   视图区                    │   对话流                        │
│                            │                                │
│   ┌────────────────────┐   │   ┌────────────────────────┐   │
│   │ Topic Header       │   │   │ Selected Node Card     │   │
│   └────────────────────┘   │   │ (Calling Card)         │   │
│                            │   └────────────────────────┘   │
│   ┌────────────────────┐   │                                │
│   │ ViewMode Tabs      │   │   ┌────────────────────────┐   │
│   └────────────────────┘   │   │ Children Tabs          │   │
│                            │   │ [最热] [最新]          │   │
│   ┌────────────────────┐   │   └────────────────────────┘   │
│   │                    │   │                                │
│   │ Visualization      │   │   ┌────────────────────────┐   │
│   │                    │   │   │ Children List          │   │
│   │                    │   │   │ (滚动区域)              │   │
│   └────────────────────┘   │   └────────────────────────┘   │
│                            │                                │
│                            │   ┌────────────────────────┐   │
│                            │   │ Reply + Vote Deck      │   │
│                            │   │ (固定底部)              │   │
│                            │   └────────────────────────┘   │
│                            │                                │
├────────────────────────────┴────────────────────────────────┤
│              对角撕裂分隔线 (CSS)                            │
└─────────────────────────────────────────────────────────────┘
```

### 实施步骤

#### Step 2.1.1: 创建双栏容器组件

创建 `apps/web/components/topics/TopicDualColumn.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

type Props = {
  left: ReactNode;
  right: ReactNode;
};

export function TopicDualColumn({ left, right }: Props) {
  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* 左栏 - 视图区 */}
      <div className="relative flex w-[60%] flex-col overflow-auto border-r-0 bg-[color:var(--concrete-300)] p-4 lg:w-[60%] md:w-1/2">
        {left}
      </div>

      {/* 对角撕裂分隔线 */}
      <div
        className="hidden w-2 flex-shrink-0 md:block"
        style={{
          background: `
            linear-gradient(135deg, var(--ink) 25%, transparent 25%),
            linear-gradient(-135deg, var(--ink) 25%, transparent 25%)
          `,
          backgroundSize: "8px 8px",
          backgroundColor: "var(--concrete-200)",
        }}
        aria-hidden="true"
      />

      {/* 右栏 - 对话流 */}
      <div className="flex w-[40%] flex-col overflow-hidden bg-[color:var(--paper)] lg:w-[40%] md:w-1/2">
        {right}
      </div>
    </div>
  );
}
```

#### Step 2.1.2: 创建 Topic 专用 TopBar

创建 `apps/web/components/topics/TopicTopBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { P5Badge } from "@/components/ui/P5Badge";

type Props = {
  title: string;
  status: "active" | "frozen" | "archived";
  balance: number | null;
  identityFingerprint: string | null;
  showBackButton?: boolean;
};

export function TopicTopBar({
  title,
  status,
  balance,
  identityFingerprint,
  showBackButton = false,
}: Props) {
  const statusVariant =
    status === "active" ? "acid" : status === "frozen" ? "electric" : "ink";

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4">
      {/* 左侧 */}
      <div className="flex items-center gap-3">
        {showBackButton && (
          <Link
            href="/topics"
            className="flex h-8 w-8 items-center justify-center border-[3px] border-[color:var(--paper)] text-[color:var(--paper)] transition-transform hover:scale-110 hover:bg-[color:var(--paper)]/10"
          >
            ◀
          </Link>
        )}
      </div>

      {/* 中间 - 标题 */}
      <h1
        className="max-w-md truncate font-display text-lg uppercase tracking-wide text-[color:var(--paper)]"
        title={title}
      >
        {title}
      </h1>

      {/* 右侧 */}
      <div className="flex items-center gap-2">
        <P5Badge variant={statusVariant}>{status}</P5Badge>

        {balance !== null && (
          <div className="flex items-center gap-1 border-[3px] border-[color:var(--paper)] bg-transparent px-2 py-1 font-mono text-sm text-[color:var(--paper)]">
            <span>◆</span>
            <span>{balance}</span>
          </div>
        )}

        {identityFingerprint && (
          <Link
            href="/my"
            className="flex items-center gap-1 border-[3px] border-[color:var(--paper)] bg-transparent px-2 py-1 font-mono text-sm text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)]/10"
            title="我的身份"
          >
            <span className="flex gap-0.5">
              <span className="h-2 w-2 rounded-full bg-[color:var(--rebel-red)]" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--acid)]" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--electric)]" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--paper)]" />
            </span>
            <span className="hidden sm:inline">{identityFingerprint}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
```

#### Step 2.1.3: 创建 Selected Node Card

创建 `apps/web/components/topics/SelectedNodeCard.tsx`:

```tsx
"use client";

import type { ArgumentNode } from "@epiphany/shared-contracts";
import { TiptapRenderer } from "@/components/ui/TiptapRenderer";

type Props = {
  node: ArgumentNode | null;
};

const STANCE_COLORS = {
  pro: "var(--electric)",
  con: "var(--rebel-red)",
  neutral: "var(--acid)",
};

export function SelectedNodeCard({ node }: Props) {
  if (!node) {
    return (
      <div className="border-[4px] border-[color:var(--ink)] bg-[color:var(--concrete-200)] p-4 text-center text-[color:var(--ink)]/60">
        点击左侧节点查看详情
      </div>
    );
  }

  const stanceColor = STANCE_COLORS[node.stance] || STANCE_COLORS.neutral;

  return (
    <div
      className="
        relative
        -rotate-[0.5deg]
        border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)]
        shadow-[4px_4px_0_var(--rebel-red),8px_8px_0_var(--ink)]
      "
    >
      {/* Stance 色条 */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: stanceColor }}
      />

      {/* 内容 */}
      <div className="p-4 pt-5">
        {/* 正文 */}
        <div className="mb-4 line-clamp-4 text-sm leading-relaxed text-[color:var(--ink)]">
          {node.bodyRich ? (
            <TiptapRenderer content={node.bodyRich} />
          ) : (
            <p>{node.body}</p>
          )}
        </div>

        {/* 元信息 */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Stance */}
          <span
            className="border-[2px] border-[color:var(--ink)] px-2 py-0.5 font-display uppercase"
            style={{ backgroundColor: stanceColor, color: node.stance === "neutral" ? "var(--ink)" : "var(--paper)" }}
          >
            {node.stance}
          </span>

          {/* 票数 */}
          <span className="flex items-center gap-1 border-[2px] border-[color:var(--ink)] bg-[color:var(--paper)] px-2 py-0.5 font-mono">
            ●{node.totalVotes}
          </span>

          {/* 作者 */}
          <span className="font-mono text-[color:var(--ink)]/60">
            {node.authorPubkey?.slice(0, 6)}...
          </span>

          {/* AI 分析状态 */}
          {node.analysisStatus && node.analysisStatus !== "completed" && (
            <span className="flex items-center gap-1 text-[color:var(--electric)]">
              AI: {node.analysisStatus === "pending" ? "⏳" : "▶"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

#### Step 2.1.4: 重构 TopicPage.tsx

修改 `apps/web/components/topics/TopicPage.tsx`:

```tsx
"use client";

// ... 现有 imports ...
import { TopicDualColumn } from "@/components/topics/TopicDualColumn";
import { TopicTopBar } from "@/components/topics/TopicTopBar";
import { SelectedNodeCard } from "@/components/topics/SelectedNodeCard";

export function TopicPage({ topicId }: Props) {
  // ... 现有 state 和 hooks ...

  // 获取选中节点
  const selectedNode = useMemo(() => {
    if (!selectedArgumentId || tree.status !== "success") return null;
    return tree.nodes.find((n) => n.id === selectedArgumentId) || null;
  }, [selectedArgumentId, tree]);

  if (tree.status === "loading") {
    return <P5SkeletonList count={3} />;
  }

  if (tree.status === "error") {
    return (
      <P5Alert role="alert" variant="error" title="error">
        {tree.errorMessage}
      </P5Alert>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Topic 专用 TopBar */}
      <TopicTopBar
        title={tree.topic.title}
        status={tree.topic.status}
        balance={ledger?.balance ?? null}
        identityFingerprint={identityFingerprint}
        showBackButton={true}
      />

      {/* 双栏布局 */}
      <TopicDualColumn
        left={
          <div className="flex h-full flex-col">
            {/* Identity Onboarding */}
            {hasIdentity === false && (
              <div className="mb-4">
                <IdentityOnboarding onComplete={() => setHasIdentity(true)} />
              </div>
            )}

            {/* Reload Banner */}
            {reloadRequired && (
              <div className="mb-4">
                <P5Alert title="reload_required" variant="warn" role="alert">
                  <div className="flex items-center justify-between">
                    <span>数据已更新，请刷新</span>
                    <P5Button onClick={() => window.location.reload()} size="sm">
                      刷新
                    </P5Button>
                  </div>
                </P5Alert>
              </div>
            )}

            {/* ViewMode Tabs */}
            <div className="mb-4 flex items-center justify-between">
              <P5Tabs
                ariaLabel="视图模式"
                value={viewMode}
                onValueChange={setViewMode}
                tabs={[
                  { value: "focus", label: "Focus" },
                  { value: "sunburst", label: "Overview" },
                  { value: "god", label: "God View" },
                ]}
              />

              <div className="flex gap-2">
                <P5Button onClick={() => setIsReportOpen(true)} size="sm">
                  Report
                </P5Button>
                {isOwner && (
                  <P5Button onClick={() => setIsManageOpen((p) => !p)} size="sm">
                    Manage
                  </P5Button>
                )}
              </div>
            </div>

            {/* Visualization */}
            <div className="min-h-0 flex-1">
              {viewMode === "god" ? (
                <GodView topicId={topicId} refreshToken={refreshToken} />
              ) : viewMode === "sunburst" ? (
                <SunburstView
                  rootId={tree.topic.rootArgumentId}
                  nodes={tree.nodes}
                  selectedId={selectedArgumentId}
                  onSelect={setSelectedArgumentId}
                />
              ) : (
                <FocusView
                  rootId={tree.topic.rootArgumentId}
                  nodes={tree.nodes}
                  selectedId={selectedArgumentId}
                  onSelect={setSelectedArgumentId}
                />
              )}
            </div>
          </div>
        }
        right={
          <div className="flex h-full flex-col">
            {/* Selected Node Card */}
            <div className="flex-shrink-0 p-4">
              <SelectedNodeCard node={selectedNode} />
            </div>

            {/* DialogueStream */}
            <div className="min-h-0 flex-1 overflow-auto">
              <DialogueStream
                topicId={topicId}
                parentArgumentId={selectedArgumentId}
                topicStatus={tree.topic.status}
                refreshToken={refreshToken}
                onInvalidate={invalidate}
                canWrite={hasIdentity === true}
                ledger={ledger}
                onLedgerUpdated={setLedger}
              />
            </div>
          </div>
        }
      />

      {/* Modals */}
      {isManageOpen && isOwner && (
        <TopicManagePanel
          topicId={topicId}
          topicTitle={tree.topic.title}
          topicStatus={tree.topic.status}
          rootBody={tree.topic.rootBody}
          onInvalidate={invalidate}
          onClose={() => setIsManageOpen(false)}
        />
      )}

      {isReportOpen && (
        <ConsensusReportModal
          topicId={topicId}
          isOwner={isOwner}
          refreshToken={refreshToken}
          onInvalidate={invalidate}
          onClose={() => setIsReportOpen(false)}
        />
      )}
    </div>
  );
}
```

---

## 2.2 列表页 TopBar

### 目标
为 `/topics` 列表页创建简化的 TopBar

### 实施步骤

#### Step 2.2.1: 创建列表页 TopBar

创建 `apps/web/components/topics/TopicsTopBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { P5Button, P5LinkButton } from "@/components/ui/P5Button";

export function TopicsTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4">
      {/* Logo */}
      <Link
        href="/"
        className="font-display text-xl tracking-wider text-[color:var(--paper)]"
        style={{
          textShadow: "2px 2px 0 var(--rebel-red)",
        }}
      >
        EP
      </Link>

      {/* 中间标题 */}
      <h1 className="font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
        TOPICS
      </h1>

      {/* 右侧操作 */}
      <div className="flex items-center gap-2">
        <P5LinkButton href="/my" size="sm" variant="ghost" className="bg-transparent text-[color:var(--paper)] border-[color:var(--paper)]">
          My
        </P5LinkButton>
        <P5LinkButton href="/topics/new" size="sm" variant="primary">
          + 创建
        </P5LinkButton>
      </div>
    </header>
  );
}
```

---

## 2.3 响应式断点

### 实施步骤

#### Step 2.3.1: 添加响应式处理

在 `TopicDualColumn.tsx` 添加移动端支持：

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { P5Tabs } from "@/components/ui/P5Tabs";

type Props = {
  left: ReactNode;
  right: ReactNode;
};

export function TopicDualColumn({ left, right }: Props) {
  const [mobileView, setMobileView] = useState<"viz" | "chat">("viz");

  return (
    <>
      {/* 桌面端：双栏 */}
      <div className="hidden h-[calc(100vh-56px)] overflow-hidden md:flex">
        {/* 左栏 */}
        <div className="relative flex w-[60%] flex-col overflow-auto bg-[color:var(--concrete-300)] p-4 lg:w-[60%]">
          {left}
        </div>

        {/* 分隔线 */}
        <div
          className="w-2 flex-shrink-0"
          style={{
            background: `
              linear-gradient(135deg, var(--ink) 25%, transparent 25%),
              linear-gradient(-135deg, var(--ink) 25%, transparent 25%)
            `,
            backgroundSize: "8px 8px",
            backgroundColor: "var(--concrete-200)",
          }}
        />

        {/* 右栏 */}
        <div className="flex w-[40%] flex-col overflow-hidden bg-[color:var(--paper)] lg:w-[40%]">
          {right}
        </div>
      </div>

      {/* 移动端：单栏切换 */}
      <div className="flex h-[calc(100vh-56px)] flex-col md:hidden">
        {/* 切换 Tabs */}
        <div className="flex-shrink-0 border-b-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-2">
          <P5Tabs
            ariaLabel="移动端视图切换"
            value={mobileView}
            onValueChange={(v) => setMobileView(v as "viz" | "chat")}
            tabs={[
              { value: "viz", label: "可视化" },
              { value: "chat", label: "对话" },
            ]}
          />
        </div>

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-auto">
          {mobileView === "viz" ? (
            <div className="h-full bg-[color:var(--concrete-300)] p-4">{left}</div>
          ) : (
            <div className="h-full bg-[color:var(--paper)]">{right}</div>
          )}
        </div>
      </div>
    </>
  );
}
```

---

## 2.4 验收清单

- [ ] TopicDualColumn
  - [ ] 桌面端 60/40 分栏显示
  - [ ] 对角撕裂分隔线可见
  - [ ] 移动端单栏切换工作

- [ ] TopicTopBar
  - [ ] 高度 56px
  - [ ] 标题截断显示
  - [ ] 余额显示正确
  - [ ] 身份指纹可点击跳转 /my

- [ ] SelectedNodeCard
  - [ ] Calling Card 风格（旋转 + 双层阴影）
  - [ ] Stance 色条显示
  - [ ] 内容截断（line-clamp-4）

- [ ] TopicsTopBar
  - [ ] Logo 带红色阴影
  - [ ] My 和创建按钮可用

---

## 预计产出文件

```
apps/web/components/topics/
├── TopicDualColumn.tsx      # 新增
├── TopicTopBar.tsx          # 新增
├── TopicsTopBar.tsx         # 新增
├── SelectedNodeCard.tsx     # 新增
└── TopicPage.tsx            # 修改
```
