"use client";

import { useState } from "react";

import { FocusView } from "@/components/topics/FocusView";
import { DialogueStream } from "@/components/topics/DialogueStream";
import { useTopicTree } from "@/components/topics/hooks/useTopicTree";

type Props = {
  topicId: string;
};

export function TopicPage({ topicId }: Props) {
  const tree = useTopicTree(topicId, 3);
  const [selectedArgumentId, setSelectedArgumentId] = useState<string | null>(
    null,
  );

  if (tree.status === "loading") {
    return <p className="text-sm text-zinc-600">Loading topic…</p>;
  }

  if (tree.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      >
        {tree.errorMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{tree.topic.title}</h1>
        <p className="text-sm text-zinc-600">
          TopicId: <code className="font-mono">{tree.topic.id}</code>
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.25fr]">
        <FocusView
          rootId={tree.topic.rootArgumentId}
          nodes={tree.nodes}
          selectedId={selectedArgumentId}
          onSelect={setSelectedArgumentId}
        />
        <DialogueStream parentArgumentId={selectedArgumentId} />
      </div>
    </div>
  );
}

