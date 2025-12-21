import Link from "next/link";

import { TopicPage } from "@/components/topics/TopicPage";

export default function TopicDetailPage({
  params,
}: {
  params: { topicId: string };
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/topics" className="text-sm text-zinc-700 hover:underline">
          Back to list
        </Link>
      </header>
      <TopicPage topicId={params.topicId} />
    </div>
  );
}
