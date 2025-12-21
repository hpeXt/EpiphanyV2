"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/lib/apiClient";

export type FocusTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
};

export type TopicHeader = {
  id: string;
  title: string;
  rootArgumentId: string;
};

type UseTopicTreeState =
  | { status: "loading"; errorMessage: ""; topic: null; nodes: [] }
  | { status: "error"; errorMessage: string; topic: null; nodes: [] }
  | { status: "success"; errorMessage: ""; topic: TopicHeader; nodes: FocusTreeNode[] };

function toLabel(input: { title: string | null; body: string; id: string }): string {
  if (input.title) return input.title;
  const trimmed = input.body.trim();
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return input.id;
}

export function useTopicTree(topicId: string, depth = 3): UseTopicTreeState {
  const [state, setState] = useState<UseTopicTreeState>({
    status: "loading",
    errorMessage: "",
    topic: null,
    nodes: [],
  });

  useEffect(() => {
    let cancelled = false;

    setState({
      status: "loading",
      errorMessage: "",
      topic: null,
      nodes: [],
    });

    (async () => {
      const result = await apiClient.getTopicTree(topicId, depth);
      if (cancelled) return;

      if (!result.ok) {
        setState({
          status: "error",
          errorMessage: result.error.message,
          topic: null,
          nodes: [],
        });
        return;
      }

      setState({
        status: "success",
        errorMessage: "",
        topic: {
          id: result.data.topic.id,
          title: result.data.topic.title,
          rootArgumentId: result.data.topic.rootArgumentId,
        },
        nodes: result.data.arguments.map((arg) => ({
          id: arg.id,
          parentId: arg.parentId,
          label: toLabel(arg),
        })),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, depth]);

  return state;
}

