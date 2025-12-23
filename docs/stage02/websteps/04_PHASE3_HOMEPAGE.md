# Phase 3: 首页旭日图（议题宇宙）

> 将首页从重定向改为聚合旭日图可视化

## 3.1 概述

### 目标
实现 `UX_UI_PLAN.md` 3.1 节定义的「议题宇宙」首页

### 当前状态
```tsx
// app/page.tsx
export default function Home() {
  redirect("/topics");
}
```

### 目标状态
全屏旭日图，展示所有公开议题的聚合视图

---

## 3.2 API 数据结构

### 需要的接口

```typescript
// GET /v1/topics/overview
interface TopicsOverviewResponse {
  topics: TopicOverviewItem[];
  stats: {
    totalTopics: number;
    totalArguments: number;
    totalVotes: number;
  };
}

interface TopicOverviewItem {
  id: string;
  title: string;
  status: "active" | "frozen" | "archived";
  totalVotes: number;
  argumentCount: number;
  stanceDistribution: {
    pro: number;
    con: number;
    neutral: number;
  };
  createdAt: string;
  lastActivityAt: string;
}
```

### 如果后端暂未实现

可先用现有 `GET /v1/topics` 接口，前端聚合计算：

```typescript
// lib/topicOverview.ts
export async function fetchTopicsOverview(): Promise<TopicsOverviewResponse> {
  const result = await apiClient.getTopics();
  if (!result.ok) throw new Error(result.error.message);

  const topics = result.data.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    totalVotes: t.totalVotes ?? 0,
    argumentCount: t.argumentCount ?? 0,
    stanceDistribution: t.stanceDistribution ?? { pro: 0, con: 0, neutral: 0 },
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt ?? t.createdAt,
  }));

  return {
    topics,
    stats: {
      totalTopics: topics.length,
      totalArguments: topics.reduce((sum, t) => sum + t.argumentCount, 0),
      totalVotes: topics.reduce((sum, t) => sum + t.totalVotes, 0),
    },
  };
}
```

---

## 3.3 TopicUniverse 组件

### 实施步骤

#### Step 3.3.1: 创建主组件

创建 `apps/web/components/home/TopicUniverse.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useRouter } from "next/navigation";
import { CallingCard } from "@/components/ui/CallingCard";

interface TopicOverviewItem {
  id: string;
  title: string;
  status: "active" | "frozen" | "archived";
  totalVotes: number;
  argumentCount: number;
  stanceDistribution: {
    pro: number;
    con: number;
    neutral: number;
  };
}

interface Stats {
  totalTopics: number;
  totalArguments: number;
  totalVotes: number;
}

type Props = {
  topics: TopicOverviewItem[];
  stats: Stats;
};

// 计算 Topic 颜色
function getTopicColor(topic: TopicOverviewItem): string {
  const { pro, con, neutral } = topic.stanceDistribution;
  const total = pro + con + neutral;

  if (total === 0) return "var(--concrete-200)";

  const proRatio = pro / total;
  const conRatio = con / total;

  if (proRatio > 0.6) return "var(--electric)";
  if (conRatio > 0.6) return "var(--rebel-red)";
  if (proRatio > 0.4 && conRatio > 0.4) return "var(--acid)";
  return "var(--concrete-100)";
}

// 计算透明度
function getTopicOpacity(status: TopicOverviewItem["status"]): number {
  switch (status) {
    case "active": return 1;
    case "frozen": return 0.7;
    case "archived": return 0.4;
  }
}

export function TopicUniverse({ topics, stats }: Props) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredTopic, setHoveredTopic] = useState<TopicOverviewItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // 响应式尺寸
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 56 - 60, // TopBar + Stats bar
      });
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // 构建旭日图数据
  const sunburstData = useMemo(() => {
    if (topics.length === 0) return null;

    // 计算热度权重
    const topicsWithWeight = topics.map((t) => ({
      ...t,
      weight: t.totalVotes + t.argumentCount * 0.5 + 1, // +1 避免 0
    }));

    // 构建层级数据
    const root = {
      name: "TM",
      children: topicsWithWeight.map((t) => ({
        name: t.title,
        value: t.weight,
        data: t,
      })),
    };

    return d3
      .hierarchy(root)
      .sum((d: any) => d.value)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [topics]);

  // 绘制旭日图
  useEffect(() => {
    if (!svgRef.current || !sunburstData) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = dimensions;
    const radius = Math.min(width, height) / 2 * 0.85;
    const innerRadius = radius * 0.18; // 中心圆

    // 分区布局
    const partition = d3.partition<any>().size([2 * Math.PI, radius]);
    const root = partition(sunburstData);

    // 弧生成器
    const arc = d3
      .arc<d3.HierarchyRectangularNode<any>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .innerRadius((d) => (d.depth === 0 ? 0 : innerRadius))
      .outerRadius((d) => (d.depth === 0 ? innerRadius : d.y1));

    // 主 group
    const g = svg
      .append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

    // 绘制扇区
    const paths = g
      .selectAll("path")
      .data(root.descendants())
      .join("path")
      .attr("d", arc as any)
      .attr("fill", (d) => {
        if (d.depth === 0) return "var(--ink)";
        return getTopicColor(d.data.data);
      })
      .attr("fill-opacity", (d) => {
        if (d.depth === 0) return 1;
        return getTopicOpacity(d.data.data.status);
      })
      .attr("stroke", "var(--ink)")
      .attr("stroke-width", (d) => (d.depth === 0 ? 0 : 2))
      .attr("cursor", (d) => (d.depth === 0 ? "default" : "pointer"))
      .style("--sector-index", (_, i) => i)
      .classed("sunburst-sector", true);

    // 入场动画
    paths
      .attr("transform", "scale(0)")
      .attr("opacity", 0)
      .transition()
      .duration(300)
      .delay((_, i) => i * 50)
      .attr("transform", "scale(1)")
      .attr("opacity", 1);

    // 交互事件
    paths
      .filter((d) => d.depth > 0)
      .on("mouseenter", function (event, d) {
        d3.select(this)
          .attr("stroke", "var(--rebel-red)")
          .attr("stroke-width", 4);

        setHoveredTopic(d.data.data);
        setTooltipPos({ x: event.clientX, y: event.clientY });
      })
      .on("mousemove", (event) => {
        setTooltipPos({ x: event.clientX, y: event.clientY });
      })
      .on("mouseleave", function () {
        d3.select(this)
          .attr("stroke", "var(--ink)")
          .attr("stroke-width", 2);

        setHoveredTopic(null);
      })
      .on("click", (_, d) => {
        // 钻入动画
        d3.select(svgRef.current)
          .transition()
          .duration(400)
          .style("transform", "scale(3)")
          .style("opacity", "0")
          .on("end", () => {
            router.push(`/topics/${d.data.data.id}`);
          });
      });

    // 中心文字
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "var(--paper)")
      .attr("font-family", "var(--font-display)")
      .attr("font-size", innerRadius * 0.5)
      .attr("letter-spacing", "0.1em")
      .text("TM");

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("y", innerRadius * 0.35)
      .attr("fill", "var(--paper)")
      .attr("font-family", "var(--font-display)")
      .attr("font-size", innerRadius * 0.15)
      .attr("letter-spacing", "0.05em")
      .attr("opacity", 0.8)
      .text("THOUGHT MARKET");

  }, [sunburstData, dimensions, router]);

  // 空态
  if (topics.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="border-[6px] border-[color:var(--ink)] bg-[color:var(--ink)] p-12 text-center shadow-[var(--p5-shadow-xl)]">
          <div className="mb-4 font-display text-4xl tracking-wider text-[color:var(--paper)]">
            TM
          </div>
          <div className="mb-2 font-display text-xl text-[color:var(--paper)]">
            THOUGHT MARKET
          </div>
          <div className="mb-6 text-[color:var(--paper)]/80">
            这里还很安静<br />
            成为第一个发起议题的人
          </div>
          <a
            href="/topics/new"
            className="inline-block border-[4px] border-[color:var(--paper)] bg-[color:var(--rebel-red)] px-6 py-3 font-display uppercase tracking-wide text-[color:var(--paper)] shadow-[var(--p5-shadow-rebel)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
          >
            + 创建议题
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[color:var(--concrete-300)]">
      {/* 旭日图 SVG */}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="transition-all duration-400"
      />

      {/* Hover Tooltip (Calling Card) */}
      {hoveredTopic && (
        <div
          className="pointer-events-none fixed z-50 animate-pop"
          style={{
            left: tooltipPos.x + 20,
            top: tooltipPos.y - 20,
            transform: "rotate(-2deg)",
          }}
        >
          <CallingCard
            title={hoveredTopic.title}
            stance={
              hoveredTopic.stanceDistribution.pro > hoveredTopic.stanceDistribution.con
                ? "pro"
                : hoveredTopic.stanceDistribution.con > hoveredTopic.stanceDistribution.pro
                ? "con"
                : "neutral"
            }
            votes={hoveredTopic.totalVotes}
            status={hoveredTopic.status}
            argumentCount={hoveredTopic.argumentCount}
          />
        </div>
      )}
    </div>
  );
}
```

#### Step 3.3.2: 创建 CallingCard Tooltip 增强

修改 `apps/web/components/ui/CallingCard.tsx` 添加首页用 props：

```tsx
// 添加新的 props
type CallingCardProps = {
  // ... 现有 props ...
  argumentCount?: number;
  status?: "active" | "frozen" | "archived";
};

// 在组件中添加显示
{argumentCount !== undefined && (
  <div className="flex items-center gap-1">
    <span>📝</span>
    <span>{argumentCount} 节点</span>
  </div>
)}

{status && (
  <P5Badge variant={status === "active" ? "acid" : status === "frozen" ? "electric" : "ink"}>
    {status}
  </P5Badge>
)}
```

---

## 3.4 首页布局

### 实施步骤

#### Step 3.4.1: 创建首页 TopBar

创建 `apps/web/components/home/HomeTopBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { P5LinkButton } from "@/components/ui/P5Button";

export function HomeTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-4">
      {/* 空占位（保持居中） */}
      <div className="w-20" />

      {/* 中间留空（旭日图为主角） */}
      <div />

      {/* 右侧操作 */}
      <div className="flex items-center gap-2">
        <P5LinkButton
          href="/my"
          size="sm"
          variant="ghost"
          className="border-[color:var(--paper)] bg-transparent text-[color:var(--paper)]"
        >
          My
        </P5LinkButton>
        <P5LinkButton href="/topics/new" size="sm" variant="primary">
          + 创建议题
        </P5LinkButton>
      </div>
    </header>
  );
}
```

#### Step 3.4.2: 创建 Stats Bar

创建 `apps/web/components/home/StatsBar.tsx`:

```tsx
"use client";

type Props = {
  totalTopics: number;
  totalArguments: number;
  totalVotes: number;
  isLive?: boolean;
};

export function StatsBar({ totalTopics, totalArguments, totalVotes, isLive = false }: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t-[3px] border-[color:var(--rebel-red)] bg-[color:var(--ink)]/90 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-center gap-6 text-[color:var(--paper)]">
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl">{totalTopics}</span>
          <span className="text-sm opacity-80">活跃议题</span>
        </div>

        <div className="h-4 w-px bg-[color:var(--paper)]/30" />

        <div className="flex items-center gap-2">
          <span className="font-display text-2xl">{totalArguments.toLocaleString()}</span>
          <span className="text-sm opacity-80">观点</span>
        </div>

        <div className="h-4 w-px bg-[color:var(--paper)]/30" />

        <div className="flex items-center gap-2">
          <span className="font-display text-2xl">{totalVotes.toLocaleString()}</span>
          <span className="text-sm opacity-80">投票</span>
        </div>

        {isLive && (
          <>
            <div className="h-4 w-px bg-[color:var(--paper)]/30" />
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--rebel-red)]" />
              <span className="text-sm opacity-80">实时更新</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

#### Step 3.4.3: 修改首页

修改 `apps/web/app/page.tsx`:

```tsx
import { HomeTopBar } from "@/components/home/HomeTopBar";
import { TopicUniverse } from "@/components/home/TopicUniverse";
import { StatsBar } from "@/components/home/StatsBar";
import { apiClient } from "@/lib/apiClient";

export default async function Home() {
  // 服务端获取数据
  const result = await apiClient.getTopics();

  if (!result.ok) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[color:var(--rebel-red)]">
          加载失败: {result.error.message}
        </div>
      </div>
    );
  }

  const topics = result.data.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    totalVotes: t.totalVotes ?? 0,
    argumentCount: t.argumentCount ?? 0,
    stanceDistribution: t.stanceDistribution ?? { pro: 0, con: 0, neutral: 0 },
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt ?? t.createdAt,
  }));

  const stats = {
    totalTopics: topics.filter((t) => t.status === "active").length,
    totalArguments: topics.reduce((sum, t) => sum + t.argumentCount, 0),
    totalVotes: topics.reduce((sum, t) => sum + t.totalVotes, 0),
  };

  return (
    <div className="flex h-screen flex-col">
      <HomeTopBar />
      <main className="relative flex-1">
        <TopicUniverse topics={topics} stats={stats} />
      </main>
      <StatsBar {...stats} />
    </div>
  );
}
```

---

## 3.5 加载状态

#### Step 3.5.1: 创建加载组件

创建 `apps/web/components/home/TopicUniverseLoading.tsx`:

```tsx
export function TopicUniverseLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[color:var(--concrete-300)]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-[4px] border-[color:var(--ink)] border-t-transparent" />
        <div className="font-display text-lg uppercase tracking-wide text-[color:var(--ink)]">
          加载议题中...
        </div>
      </div>
    </div>
  );
}
```

---

## 3.6 验收清单

- [ ] TopicUniverse
  - [ ] 旭日图正确渲染
  - [ ] 扇区角度 ∝ 热度
  - [ ] 扇区颜色 = 立场分布
  - [ ] 扇区入场动画（逐个生长）
  - [ ] Hover 显示 Calling Card
  - [ ] Click 触发钻入动画 + 跳转
  - [ ] 空态显示创建引导

- [ ] HomeTopBar
  - [ ] 极简设计（不抢旭日图视觉）
  - [ ] My 和创建按钮可用

- [ ] StatsBar
  - [ ] 固定底部
  - [ ] 统计数字正确
  - [ ] 实时指示器（可选）

---

## 预计产出文件

```
apps/web/
├── app/
│   └── page.tsx              # 修改：首页旭日图
├── components/
│   ├── home/
│   │   ├── TopicUniverse.tsx       # 新增
│   │   ├── TopicUniverseLoading.tsx # 新增
│   │   ├── HomeTopBar.tsx          # 新增
│   │   └── StatsBar.tsx            # 新增
│   └── ui/
│       └── CallingCard.tsx         # 修改：增加 props
└── lib/
    └── topicOverview.ts            # 新增（可选）
```
