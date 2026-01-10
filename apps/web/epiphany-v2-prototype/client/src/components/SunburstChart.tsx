import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

export interface SunburstNode {
  id?: number;
  name: string;
  theme?: string | null;
  content?: string | null;
  authorName?: string | null;
  voteScore?: number;
  value?: number;
  sentiment?: number | null;
  children?: SunburstNode[];
}

interface HoverCardData {
  node: SunburstNode;
  x: number;
  y: number;
}

interface SunburstChartProps {
  data: SunburstNode;
  width?: number;
  height?: number;
  onNodeClick?: (node: SunburstNode | null) => void;
  onNodeHover?: (node: SunburstNode | null, event?: MouseEvent) => void;
  selectedNodeId?: number | null;
  topicTitle?: string;
}

// Strip HTML tags from a string
const stripHtml = (html: string | null | undefined): string => {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

// Theme color palette - distinct colors for different themes
// Each theme gets a unique, visually distinguishable color
const themeColors: Record<string, string> = {
  // Pre-defined theme colors with good contrast
  "default": "#8B7355",      // Warm brown (default/uncategorized)
  "经济": "#4A90A4",         // Ocean blue
  "社会": "#7B8B6B",         // Sage green  
  "技术": "#9B6B8E",         // Dusty purple
  "环境": "#5B9B7B",         // Teal green
  "政治": "#A07355",         // Terracotta
  "文化": "#8B6B9B",         // Lavender
  "教育": "#6B8B9B",         // Steel blue
  "健康": "#9B8B5B",         // Olive gold
  "科学": "#5B7B9B",         // Slate blue
  "法律": "#8B5B6B",         // Mauve
};

// Dynamic color palette for themes not in the pre-defined list
const dynamicColors = [
  "#D4A574", // Warm sand
  "#7BA3A8", // Teal
  "#A8937B", // Taupe
  "#8BA87B", // Moss green
  "#A87B8B", // Rose
  "#7B8BA8", // Periwinkle
  "#A8A87B", // Olive
  "#7BA88B", // Seafoam
  "#A87BA8", // Orchid
  "#8BA8A8", // Aqua gray
  "#A88B7B", // Copper
  "#7B9BA8", // Sky blue
];

// Map to track dynamically assigned colors
const dynamicThemeColorMap = new Map<string, string>();
let dynamicColorIndex = 0;

// Get color for a theme
const getThemeColor = (theme: string | null | undefined): string => {
  const normalizedTheme = theme?.trim() || "default";
  
  // Check pre-defined colors first
  if (themeColors[normalizedTheme]) {
    return themeColors[normalizedTheme];
  }
  
  // Check if we've already assigned a dynamic color
  if (dynamicThemeColorMap.has(normalizedTheme)) {
    return dynamicThemeColorMap.get(normalizedTheme)!;
  }
  
  // Assign a new dynamic color
  const color = dynamicColors[dynamicColorIndex % dynamicColors.length];
  dynamicThemeColorMap.set(normalizedTheme, color);
  dynamicColorIndex++;
  
  return color;
};

// Get color with depth-based shading
const getColorWithDepth = (baseColor: string, depth: number): string => {
  // Darken for deeper levels
  const darkenFactor = 1 - (depth - 1) * 0.15;
  return d3.color(baseColor)?.darker(1 - darkenFactor)?.toString() || baseColor;
};

export function SunburstChart({
  data,
  width = 500,
  height = 500,
  onNodeClick,
  onNodeHover,
  selectedNodeId,
  topicTitle,
}: SunburstChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverCard, setHoverCard] = useState<HoverCardData | null>(null);

  const handleNodeClick = useCallback((node: SunburstNode | null) => {
    // Hide hover card when clicking a node
    setHoverCard(null);
    if (onNodeClick && node?.id) {
      onNodeClick(node);
    }
  }, [onNodeClick]);

  const handleNodeHover = useCallback((node: SunburstNode | null, event?: MouseEvent) => {
    if (node && event && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const x = event.clientX - containerRect.left;
      const y = event.clientY - containerRect.top;
      setHoverCard({ node, x, y });
    } else {
      setHoverCard(null);
    }
    if (onNodeHover) {
      onNodeHover(node, event);
    }
  }, [onNodeHover]);

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const radius = Math.min(width, height) / 2;
    const innerRadius = radius * 0.25; // Slightly larger center hole

    // Create hierarchy
    const root = d3.hierarchy(data)
      .sum(d => d.value || 1)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Create partition layout
    const partition = d3.partition<SunburstNode>()
      .size([2 * Math.PI, radius]);

    partition(root);

    // Arc generator with more padding for cleaner look
    const arc = d3.arc<d3.HierarchyRectangularNode<SunburstNode>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .innerRadius(d => Math.max(innerRadius, d.y0))
      .outerRadius(d => d.y1 - 2)
      .padAngle(0.008)
      .padRadius(radius / 2)
      .cornerRadius(2);

    // Create main group
    const g = svg
      .attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`)
      .append("g");

    // Draw arcs with theme-based colors
    g.selectAll("path")
      .data(root.descendants().filter(d => d.depth > 0))
      .join("path")
      .attr("d", arc as any)
      .attr("fill", d => {
        // Get theme from current node or parent (for grouped mode)
        const theme = d.data.theme || d.parent?.data.theme || null;
        
        // Get base color for theme
        const baseColor = getThemeColor(theme);
        
        // Apply depth-based shading
        return getColorWithDepth(baseColor, d.depth);
      })
      .attr("stroke", "#FDFBF6") // Warm cream background color
      .attr("stroke-width", 2)
      .attr("opacity", d => {
        if (selectedNodeId && d.data.id !== selectedNodeId) {
          return 0.6;
        }
        return 1;
      })
      .style("cursor", d => d.data.id ? "pointer" : "default")
      .style("transition", "opacity 0.2s ease, transform 0.2s ease")
      .on("click", (event, d) => {
        event.stopPropagation();
        if (d.data.id) {
          handleNodeClick(d.data);
        }
      })
      .on("mouseenter", function(event, d) {
        d3.select(this)
          .attr("opacity", 1)
          .style("filter", "brightness(1.1)");
        if (d.data.id || d.data.name !== "root") {
          handleNodeHover(d.data, event as unknown as MouseEvent);
        }
      })
      .on("mousemove", (event, d) => {
        if (d.data.id || d.data.name !== "root") {
          handleNodeHover(d.data, event as unknown as MouseEvent);
        }
      })
      .on("mouseleave", function(event, d) {
        d3.select(this)
          .attr("opacity", selectedNodeId && d.data.id !== selectedNodeId ? 0.6 : 1)
          .style("filter", "none");
        handleNodeHover(null);
      });

    // Center circle with topic title (no text labels on outer rings)
    g.append("circle")
      .attr("r", innerRadius - 8)
      .attr("fill", "#FDFBF6")
      .attr("stroke", "#E0DACE")
      .attr("stroke-width", 1);

    // Center text - show topic title
    const displayTitle = topicTitle || data.name;
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-family", "var(--font-serif)")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .attr("fill", "#333333")
      .text(displayTitle.length > 12 ? displayTitle.slice(0, 10) + "..." : displayTitle);

  }, [data, width, height, selectedNodeId, topicTitle, handleNodeClick, handleNodeHover]);

  // Calculate card position to keep it within bounds
  const getCardPosition = (x: number, y: number) => {
    const cardWidth = 280;
    const cardHeight = 180;
    const padding = 16;
    
    let left = x + padding;
    let top = y + padding;
    
    if (left + cardWidth > width) {
      left = x - cardWidth - padding;
    }
    
    if (top + cardHeight > height) {
      top = y - cardHeight - padding;
    }
    
    left = Math.max(padding, Math.min(left, width - cardWidth - padding));
    top = Math.max(padding, Math.min(top, height - cardHeight - padding));
    
    return { left, top };
  };

  return (
    <div ref={containerRef} className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="overflow-visible"
      />
      
      {/* Hover Card - Academic style, hidden when a node is selected */}
      {hoverCard && !selectedNodeId && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            ...getCardPosition(hoverCard.x, hoverCard.y),
            width: 280,
          }}
        >
          <div className="bg-[#FDFBF6] border border-[#E0DACE] rounded shadow-md p-4 animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Card Header */}
            <div className="mb-2">
              {hoverCard.node.theme && (
                <span className="text-[10px] font-medium text-[#8B7355] uppercase tracking-wider">
                  {hoverCard.node.theme}
                </span>
              )}
              <h3 className="font-serif text-base font-semibold text-[#333333] leading-tight mt-0.5">
                {stripHtml(hoverCard.node.name)}
              </h3>
            </div>
            
            {/* Card Content */}
            {hoverCard.node.content && (
              <p className="text-xs text-[#666666] leading-relaxed line-clamp-3 mb-2">
                {hoverCard.node.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}
              </p>
            )}
            
            {/* Card Footer */}
            <div className="flex items-center justify-between text-[10px] text-[#888888] pt-2 border-t border-[#E0DACE]">
              {hoverCard.node.authorName && (
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-[#8B7355] text-white flex items-center justify-center text-[8px] font-medium">
                    {hoverCard.node.authorName.charAt(0).toUpperCase()}
                  </span>
                  {hoverCard.node.authorName}
                </span>
              )}
              {hoverCard.node.voteScore !== undefined && (
                <span>{hoverCard.node.voteScore} votes</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SunburstChart;
