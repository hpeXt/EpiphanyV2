"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useRouter } from "next/navigation";
import { P5Badge } from "@/components/ui/P5Badge";
import { BRAND } from "@/lib/brand";

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
    case "active":
      return 1;
    case "frozen":
      return 0.7;
    case "archived":
      return 0.4;
  }
}

// 获取主要立场
function getDominantStance(
  topic: TopicOverviewItem
): "pro" | "con" | "neutral" {
  const { pro, con, neutral } = topic.stanceDistribution;
  if (pro > con && pro > neutral) return "pro";
  if (con > pro && con > neutral) return "con";
  return "neutral";
}

export function TopicUniverse({ topics, stats }: Props) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredTopic, setHoveredTopic] = useState<TopicOverviewItem | null>(
    null
  );
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
      name: BRAND.mark,
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
    const radius = (Math.min(width, height) / 2) * 0.85;
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
        d3.select(this).attr("stroke", "var(--ink)").attr("stroke-width", 2);

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
      .attr("font-family", "var(--font-display-stack)")
      .attr("font-size", innerRadius * 0.5)
      .attr("letter-spacing", "0.1em")
      .text(BRAND.mark);

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("y", innerRadius * 0.35)
      .attr("fill", "var(--paper)")
      .attr("font-family", "var(--font-display-stack)")
      .attr("font-size", innerRadius * 0.12)
      .attr("letter-spacing", "0.05em")
      .attr("opacity", 0.8)
      .text(BRAND.nameUpper);
  }, [sunburstData, dimensions, router]);

  // 空态
  if (topics.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="border-[6px] border-[color:var(--ink)] bg-[color:var(--ink)] p-12 text-center shadow-[var(--p5-shadow-xl)]">
          <div className="mb-4 font-display text-4xl tracking-wider text-[color:var(--paper)]">
            {BRAND.mark}
          </div>
          <div className="mb-2 font-display text-xl text-[color:var(--paper)]">
            {BRAND.nameUpper}
          </div>
          <div className="mb-6 text-[color:var(--paper)]/80">
            这里还很安静
            <br />
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

      {/* Hover Tooltip (Calling Card Style) */}
      {hoveredTopic && (
        <div
          className="pointer-events-none fixed z-50 animate-pop"
          style={{
            left: tooltipPos.x + 20,
            top: tooltipPos.y - 20,
          }}
        >
          <div
            className="w-[240px] -rotate-[0.6deg] skew-x-[-3deg] border-[4px] border-[color:var(--ink)] bg-[color:var(--paper)] shadow-[var(--p5-shadow-rebel)]"
            style={{
              transition:
                "transform var(--p5-motion-tooltip-snap-duration) var(--p5-motion-tooltip-snap-ease)",
            }}
          >
            {/* Header */}
            <div className="border-b-[4px] border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-2 text-[color:var(--paper)]">
              <div className="truncate font-display text-sm uppercase tracking-wide">
                {hoveredTopic.title}
              </div>
            </div>

            {/* Content */}
            <div className="space-y-2 px-3 py-2 text-xs text-[color:var(--ink)]">
              <div className="flex items-center gap-2">
                <P5Badge
                  variant={
                    getDominantStance(hoveredTopic) === "pro"
                      ? "electric"
                      : getDominantStance(hoveredTopic) === "con"
                        ? "rebel"
                        : "acid"
                  }
                >
                  {getDominantStance(hoveredTopic).toUpperCase()}
                </P5Badge>
                <P5Badge
                  variant={
                    hoveredTopic.status === "active"
                      ? "acid"
                      : hoveredTopic.status === "frozen"
                        ? "electric"
                        : "ink"
                  }
                >
                  {hoveredTopic.status}
                </P5Badge>
              </div>

              <div className="flex justify-between">
                <span>●{hoveredTopic.totalVotes} 票</span>
                <span>📝{hoveredTopic.argumentCount} 节点</span>
              </div>

              <div className="mt-2 text-[color:var(--ink)]/60">点击进入 →</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
