import Link from "next/link";

import { TopicList } from "@/components/topics/TopicList";

export default function TopicsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Topics</h1>
        <Link
          href="/topics/new"
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white"
        >
          Create topic
        </Link>
      </header>
      <TopicList />
    </div>
  );
}

