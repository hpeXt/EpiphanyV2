import Link from "next/link";

export default function TopicDetailPage({
  params,
}: {
  params: { topicId: string };
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Topic</h1>
        <p className="text-sm text-zinc-600">
          TopicId: <code className="font-mono">{params.topicId}</code>
        </p>
        <Link href="/topics" className="text-sm text-zinc-700 hover:underline">
          Back to list
        </Link>
      </header>
      <p className="text-sm text-zinc-700">
        Placeholder page. Focus View will land in Step 14.
      </p>
    </div>
  );
}
