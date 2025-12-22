import Link from "next/link";

import { TopicPage } from "@/components/topics/TopicPage";

type Params = { topicId: string };

export default async function TopicDetailPage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  const { topicId } = await params;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/topics" className="text-sm text-zinc-700 hover:underline">
          Back to list
        </Link>
      </header>
      <TopicPage topicId={topicId} />
    </div>
  );
}
