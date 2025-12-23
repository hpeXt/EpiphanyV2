import { HomeTopBar } from "@/components/home/HomeTopBar";
import { TopicUniverse } from "@/components/home/TopicUniverse";
import { StatsBar } from "@/components/home/StatsBar";
import { apiClient } from "@/lib/apiClient";

export default async function Home() {
  // 服务端获取数据
  const result = await apiClient.listTopics();

  if (!result.ok) {
    return (
      <div className="flex h-screen flex-col">
        <HomeTopBar />
        <div className="flex flex-1 items-center justify-center">
          <div className="border-[4px] border-[color:var(--rebel-red)] bg-[color:var(--paper)] p-6 text-center">
            <div className="font-display text-lg uppercase text-[color:var(--rebel-red)]">
              加载失败
            </div>
            <div className="mt-2 text-sm text-[color:var(--ink)]">
              {result.error.message}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 转换数据格式
  const topics = result.data.items.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    // 这些字段如果 API 没有返回，使用默认值
    totalVotes: 0,
    argumentCount: 0,
    stanceDistribution: { pro: 0, con: 0, neutral: 0 },
  }));

  const stats = {
    totalTopics: topics.filter((t) => t.status === "active").length,
    totalArguments: topics.reduce((sum, t) => sum + t.argumentCount, 0),
    totalVotes: topics.reduce((sum, t) => sum + t.totalVotes, 0),
  };

  return (
    <div className="flex h-screen flex-col">
      <HomeTopBar />
      <main className="relative flex-1 pb-16">
        <TopicUniverse topics={topics} stats={stats} />
      </main>
      <StatsBar {...stats} />
    </div>
  );
}
