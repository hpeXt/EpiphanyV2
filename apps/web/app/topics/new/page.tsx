import Link from "next/link";

import { CreateTopicForm } from "@/components/topics/CreateTopicForm";

export default function NewTopicPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Create topic</h1>
        <Link href="/topics" className="text-sm text-zinc-700 hover:underline">
          Back to list
        </Link>
      </header>
      <CreateTopicForm />
    </div>
  );
}

