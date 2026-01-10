import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useParams } from "wouter";
import { Send, ChevronUp, ChevronDown } from "lucide-react";
import { useState } from "react";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import SunburstChart from "@/components/SunburstChart";
import { RichTextEditor, RichTextContent } from "@/components/RichTextEditor";
import { cn, stripHtml } from "@/lib/utils";

import type { SunburstNode } from "@/components/SunburstChart";

/**
 * Topic Detail Page - Clean Academic Paper Style Design
 * Two-column layout: Topic Explorer + Article Content
 * No header - clean immersive experience
 */
export default function TopicDetail() {
  const params = useParams<{ slug: string }>();
  const { user, isAuthenticated } = useAuth();
  
  // State
  const [selectedViewpoint, setSelectedViewpoint] = useState<number | null>(null);
  const [newViewpointContent, setNewViewpointContent] = useState("");
  const [voteStrength, setVoteStrength] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [hoverSide, setHoverSide] = useState<'left' | 'right' | null>(null);
  const [editingTheme, setEditingTheme] = useState<{ viewpointId: number; currentTheme: string | null } | null>(null);
  const [newTheme, setNewTheme] = useState("");

  // Fetch topic data
  const { data: topic, isLoading: topicLoading } = trpc.topic.getWithStats.useQuery(
    { slug: params.slug || "" },
    { enabled: !!params.slug }
  );

  // Derive groupByTheme from topic's themeMode setting (host-controlled)
  const groupByTheme = topic?.themeMode === "grouped";

  // Fetch sunburst data
  const { data: sunburstData, refetch: refetchSunburst } = trpc.viewpoint.getSunburstData.useQuery(
    { topicId: topic?.id || 0, groupByTheme },
    { enabled: !!topic?.id }
  );

  // Fetch themes for this topic
  const { data: themes } = trpc.viewpoint.getThemes.useQuery(
    { topicId: topic?.id || 0 },
    { enabled: !!topic?.id }
  );

  // Set theme mutation (host only)
  const setThemeMutation = trpc.viewpoint.setTheme.useMutation({
    onSuccess: () => {
      refetchSunburst();
      setEditingTheme(null);
      setNewTheme("");
      toast.success("主题已更新");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Toggle theme mode mutation (host only)
  const utils = trpc.useUtils();
  const setThemeModeMutation = trpc.topic.setThemeMode.useMutation({
    onSuccess: () => {
      utils.topic.getWithStats.invalidate({ slug: params.slug });
      refetchSunburst();
      toast.success("显示模式已更新");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Fetch selected viewpoint details
  const { data: viewpointDetail } = trpc.viewpoint.getById.useQuery(
    { id: selectedViewpoint || 0 },
    { enabled: !!selectedViewpoint }
  );

  // Fetch user's voting power
  const { data: creditsData } = trpc.vote.getCredits.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Fetch AI report
  const { data: reportData, refetch: refetchReport } = trpc.topic.getReport.useQuery(
    { topicId: topic?.id || 0 },
    { enabled: !!topic?.id }
  );

  // Generate AI report mutation
  const generateReport = trpc.topic.generateReport.useMutation({
    onSuccess: () => {
      refetchReport();
      toast.success("报告生成成功");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Create viewpoint mutation
  const createViewpoint = trpc.viewpoint.create.useMutation({
    onSuccess: () => {
      setNewViewpointContent("");
      refetchSunburst();
      toast.success("观点提交成功");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Vote mutation
  const castVote = trpc.vote.cast.useMutation({
    onSuccess: () => {
      refetchSunburst();
      toast.success("投票已记录");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Handle node click in sunburst
  const handleNodeClick = (node: SunburstNode | null) => {
    if (node?.id) {
      setSelectedViewpoint(node.id);
      setVoteStrength(0);
    }
  };

  // Handle viewpoint submission
  const handleSubmitViewpoint = () => {
    if (!newViewpointContent.trim()) {
      toast.error("请输入观点内容");
      return;
    }
    if (!topic?.id) return;

    // Generate a title from content (first 50 chars or first sentence)
    const content = newViewpointContent.trim();
    const firstSentence = content.split(/[。.!！?？\n]/)[0];
    const title = firstSentence.length > 50 ? firstSentence.slice(0, 47) + "..." : firstSentence;

    createViewpoint.mutate({
      topicId: topic.id,
      parentId: selectedViewpoint || undefined,
      title: title,
      content: content,
    });
  };

  // Handle quadratic voting - only positive votes (0-10)
  const handleVoteChange = (delta: number) => {
    const newStrength = voteStrength + delta;
    // Only allow positive votes (0 to 10)
    if (newStrength >= 0 && newStrength <= 10) {
      const newCost = newStrength * newStrength;
      const availablePower = creditsData?.credits || 100;
      const currentCost = voteStrength * voteStrength;
      
      if (newCost - currentCost <= availablePower) {
        setVoteStrength(newStrength);
      } else {
        toast.error("投票力不足");
      }
    }
  };

  const handleSubmitVote = () => {
    if (!selectedViewpoint || !isAuthenticated || voteStrength === 0) return;
    castVote.mutate({ viewpointId: selectedViewpoint, voteCount: voteStrength });
  };

  const voteCost = voteStrength * voteStrength;

  if (topicLoading) {
    return (
      <div className="min-h-screen bg-[#FDFBF6] flex items-center justify-center">
        <div className="text-[#666666]">Loading...</div>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="min-h-screen bg-[#FDFBF6] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#666666] mb-4">Topic not found</p>
          <Button variant="outline" asChild>
            <Link href="/">Return Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Handle mouse move for dynamic layout
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    // Don't change layout when a viewpoint is selected
    if (selectedViewpoint) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const threshold = width * 0.4; // 40% from each side
    
    if (x < threshold) {
      setHoverSide('left');
    } else if (x > width - threshold) {
      setHoverSide('right');
    } else {
      setHoverSide(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] flex flex-col">
      {/* Main Content - Two Column Layout (No Header) */}
      <main 
        className="flex-1 flex overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => !selectedViewpoint && setHoverSide(null)}
      >
        {/* Left Column - Topic Explorer with Sunburst */}
        <div 
          className={cn(
            "bg-[#FDFBF6] border-r border-[#E0DACE] flex flex-col overflow-hidden transition-all duration-300 ease-out",
            selectedViewpoint 
              ? "w-[280px] min-w-[280px]" // Narrow width when viewpoint selected for more content space
              : hoverSide === 'left' 
                ? "w-[55%] min-w-[450px]" // Expanded when hovering left
                : hoverSide === 'right'
                  ? "w-[300px] min-w-[300px]" // Contracted when hovering right
                  : "w-[420px] min-w-[420px]" // Default width
          )}
        >
          {/* Topic Title Header */}
          <div className="p-5 border-b border-[#E0DACE]">
            <h2 className="font-serif text-xl text-[#333333]">
              {topic.title}
            </h2>
            
            {/* Theme List (when in theme mode) */}
            {groupByTheme && themes && themes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {themes.map((theme) => (
                  <span 
                    key={theme}
                    className="px-2 py-0.5 text-xs bg-[#E8E4DC] text-[#666666] rounded-full"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Sunburst Visualization */}
          <div 
            className="flex-1 flex items-center justify-center p-4 overflow-hidden cursor-pointer"
            onClick={(e) => {
              // Click on empty area returns to root state
              if (e.target === e.currentTarget) {
                setSelectedViewpoint(null);
                setVoteStrength(0);
              }
            }}
          >
            {sunburstData ? (
              <SunburstChart
                data={sunburstData}
                width={selectedViewpoint ? 240 : 380}
                height={selectedViewpoint ? 240 : 380}
                onNodeClick={handleNodeClick}
                selectedNodeId={selectedViewpoint}
                topicTitle={topic.title}
              />
            ) : (
              <div className="text-center text-[#666666]">
                <p className="mb-4">No viewpoints yet</p>
              </div>
            )}
          </div>

          {/* Stats and Report Button at bottom of left column */}
          <div className="p-4 border-t border-[#E0DACE]">
            <div className="flex justify-between text-xs text-[#888888] mb-3">
              <span>{topic.stats?.viewpointCount || 0} viewpoints</span>
              <span>{topic.stats?.participantCount || 0} participants</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs border-[#E0DACE] hover:bg-[#F5F3EE] mb-3"
              onClick={() => setShowReport(true)}
            >
              查看 AI 分析报告
            </Button>
            
            {/* Host-only: Theme Mode Toggle */}
            {isAuthenticated && topic.creatorId === user?.id && (
              <div className="flex items-center justify-between mb-3 py-2 px-3 bg-[#F5F3EE] rounded text-xs">
                <span className="text-[#666666]">主题分组模式</span>
                <button
                  onClick={() => {
                    setThemeModeMutation.mutate({
                      topicId: topic.id,
                      themeMode: groupByTheme ? "flat" : "grouped"
                    });
                  }}
                  disabled={setThemeModeMutation.isPending}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-colors duration-200",
                    groupByTheme ? "bg-[#8B7355]" : "bg-[#D0C9BC]"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-sm",
                      groupByTheme && "translate-x-5"
                    )}
                  />
                </button>
              </div>
            )}
            
            <div className="text-center">
              <Link href="/" className="text-xs text-[#AAAAAA] hover:text-[#666666] transition-colors">
                Hosted by Epiphany
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column - Article/Viewpoint Content */}
        <div className="flex-1 bg-[#FDFBF6] flex flex-col overflow-hidden transition-all duration-300 ease-out">
          {selectedViewpoint && viewpointDetail ? (
            // Viewpoint Detail View
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Article Header */}
              <div className="p-6 border-b border-[#E0DACE]">
                <h1 className="font-serif text-2xl text-[#333333] leading-tight mb-3">
                  {stripHtml(viewpointDetail.title)}
                </h1>
                <div className="flex items-center gap-3 text-sm text-[#666666]">
                  <span>{viewpointDetail.author?.name || "Anonymous"}</span>
                  <span className="text-[#E0DACE]">·</span>
                  <span>{new Date(viewpointDetail.createdAt).toLocaleDateString()}</span>
                  
                  {/* Theme badge and editor (host only) */}
                  {viewpointDetail.theme && (
                    <>
                      <span className="text-[#E0DACE]">·</span>
                      <span className="px-2 py-0.5 text-xs bg-[#E8E4DC] rounded-full">
                        {viewpointDetail.theme}
                      </span>
                    </>
                  )}
                  
                  {/* Host can edit theme when theme mode is enabled */}
                  {groupByTheme && isAuthenticated && topic?.creatorId === user?.id && (
                    <>
                      <span className="text-[#E0DACE]">·</span>
                      {editingTheme?.viewpointId === viewpointDetail.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={newTheme}
                            onChange={(e) => setNewTheme(e.target.value)}
                            placeholder="输入主题..."
                            className="px-2 py-0.5 text-xs border border-[#E0DACE] rounded w-24 focus:outline-none focus:border-[#8B7355]"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              setThemeMutation.mutate({
                                viewpointId: viewpointDetail.id,
                                theme: newTheme || null
                              });
                            }}
                            className="px-2 py-0.5 text-xs bg-[#8B7355] text-white rounded hover:bg-[#7A6548]"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => {
                              setEditingTheme(null);
                              setNewTheme("");
                            }}
                            className="px-2 py-0.5 text-xs text-[#666666] hover:text-[#333333]"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTheme({ 
                              viewpointId: viewpointDetail.id, 
                              currentTheme: viewpointDetail.theme 
                            });
                            setNewTheme(viewpointDetail.theme || "");
                          }}
                          className="px-2 py-0.5 text-xs text-[#6B8E8E] hover:bg-[#E0DACE] rounded"
                        >
                          {viewpointDetail.theme ? "编辑主题" : "设置主题"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Article Content - Clean reading view without toolbar */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 pr-8">
                  {viewpointDetail.content ? (
                    <div className="prose prose-sm max-w-none text-[#333333] leading-relaxed">
                      <RichTextContent content={viewpointDetail.content} />
                    </div>
                  ) : (
                    <p className="text-[#666666] italic">
                      No detailed content provided.
                    </p>
                  )}
                </div>
              </div>

              {/* Quadratic Voting Section - Only positive votes */}
              {isAuthenticated && (
                <div className="border-t border-[#E0DACE] p-4 bg-[#F8F6F1]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-[#666666]">支持度:</span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 border-[#E0DACE]"
                          onClick={() => handleVoteChange(-1)}
                          disabled={voteStrength === 0}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <div className="w-12 text-center">
                          <span className={cn(
                            "text-lg font-medium",
                            voteStrength > 0 && "text-green-600",
                            voteStrength === 0 && "text-[#666666]"
                          )}>
                            {voteStrength}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 border-[#E0DACE]"
                          onClick={() => handleVoteChange(1)}
                          disabled={voteStrength === 10}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="text-xs text-[#888888]">
                        消耗: {voteCost}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSubmitVote}
                      disabled={voteStrength === 0 || castVote.isPending}
                      className="bg-[#333333] hover:bg-[#444444]"
                    >
                      确认投票
                    </Button>
                  </div>
                </div>
              )}

              {/* Response Editor - Content only, no title */}
              {isAuthenticated && (
                <div className="border-t border-[#E0DACE] p-4">
                  <RichTextEditor
                    content={newViewpointContent}
                    onChange={setNewViewpointContent}
                    placeholder="分享你的观点..."
                    minHeight="100px"
                    showToolbar={false}
                  />
                  <div className="flex justify-end mt-3">
                    <Button
                      onClick={handleSubmitViewpoint}
                      disabled={createViewpoint.isPending || !newViewpointContent.trim()}
                      className="gap-2 bg-[#333333] hover:bg-[#444444]"
                    >
                      <Send className="h-4 w-4" />
                      提交
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Empty State - Prompt to select or create
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <h2 className="font-serif text-2xl text-[#333333] mb-4">
                选择一个观点来探索
              </h2>
              <p className="text-[#666666] mb-6 max-w-md">
                点击旭日图中的任意区块来查看详情并参与讨论。
              </p>
              {isAuthenticated && (
                <div className="w-full max-w-lg">
                  <h3 className="font-serif text-lg text-[#333333] mb-4">
                    或者分享你的观点
                  </h3>
                  <RichTextEditor
                    content={newViewpointContent}
                    onChange={setNewViewpointContent}
                    placeholder="详细阐述你的观点..."
                    minHeight="200px"
                    showToolbar={false}
                  />
                  <div className="flex justify-end mt-3">
                    <Button
                      onClick={handleSubmitViewpoint}
                      disabled={createViewpoint.isPending || !newViewpointContent.trim()}
                      className="gap-2 bg-[#333333] hover:bg-[#444444]"
                    >
                      <Send className="h-4 w-4" />
                      提交观点
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer with Login */}
          {!isAuthenticated && (
            <div className="border-t border-[#E0DACE] px-6 py-3 flex items-center justify-end bg-[#FDFBF6]">
              <a 
                href={getLoginUrl()} 
                className="text-xs text-[#AAAAAA] hover:text-[#666666] transition-colors"
              >
                登录参与讨论
              </a>
            </div>
          )}
        </div>
      </main>

      {/* AI Report Modal */}
      {showReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#FDFBF6] rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-[#E0DACE] flex items-center justify-between">
              <h2 className="font-serif text-xl text-[#333333]">AI 分析报告</h2>
              <button
                onClick={() => setShowReport(false)}
                className="text-[#666666] hover:text-[#333333] text-2xl leading-none"
              >
                ×
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {reportData?.report ? (
                <div className="space-y-4">
                  <div className="text-xs text-[#888888] mb-4">
                    生成时间: {new Date(reportData.report.generatedAt).toLocaleString()}
                    {' · '}
                    基于 {reportData.report.viewpointCount} 个观点
                    {' · '}
                    共 {reportData.report.totalVotes} 票
                  </div>
                  <div className="prose prose-sm max-w-none text-[#333333] whitespace-pre-wrap leading-relaxed">
                    {reportData.report.content}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-[#666666] mb-4">还没有生成报告</p>
                  <p className="text-sm text-[#888888] mb-6">
                    AI 将分析所有观点，生成共识与分歧报告
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#E0DACE] flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowReport(false)}
                className="border-[#E0DACE]"
              >
                关闭
              </Button>
              <Button
                onClick={() => topic?.id && generateReport.mutate({ topicId: topic.id })}
                disabled={generateReport.isPending || !topic?.stats?.viewpointCount}
                className="bg-[#333333] hover:bg-[#444444]"
              >
                {generateReport.isPending ? "生成中..." : reportData?.report ? "重新生成" : "生成报告"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
