import { TopicStage } from "@/components/topics/TopicStage";

type Params = { topicId: string };

export default async function TopicStagePage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  const { topicId } = await params;
  return <TopicStage topicId={topicId} />;
}
