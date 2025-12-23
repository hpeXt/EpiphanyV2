"use client";

import { useEffect, useState } from "react";

import type { Argument } from "@epiphany/shared-contracts";
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
  status: "active" | "frozen" | "archived";
  ownerPubkey: string | null;
  rootBody: string;
};

type UseTopicTreeState =
  | { status: "loading"; errorMessage: ""; topic: null; nodes: []; arguments: [] }
  | { status: "error"; errorMessage: string; topic: null; nodes: []; arguments: [] }
  | { status: "success"; errorMessage: ""; topic: TopicHeader; nodes: FocusTreeNode[]; arguments: Argument[] };

function toLabel(input: { title: string | null; body: string; id: string }): string {
  if (input.title) return input.title;
  const trimmed = input.body.trim();
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return input.id;
}

export function useTopicTree(
  topicId: string,
  depth = 3,
  refreshToken = 0,
): UseTopicTreeState {
  const [state, setState] = useState<UseTopicTreeState>({
    status: "loading",
    errorMessage: "",
    topic: null,
    nodes: [],
    arguments: [],
  });

  useEffect(() => {
    let cancelled = false;

    setState((prev) => {
      if (prev.status === "success" && prev.topic.id === topicId) {
        return prev;
      }
      return {
        status: "loading",
        errorMessage: "",
        topic: null,
        nodes: [],
        arguments: [],
      };
    });

    (async () => {
      const result = await apiClient.getTopicTree(topicId, depth);
      if (cancelled) return;

      if (!result.ok) {
        setState((prev) => {
          if (prev.status === "success" && prev.topic.id === topicId) {
            return prev;
          }
          return {
            status: "error",
            errorMessage: result.error.message,
            topic: null,
            nodes: [],
            arguments: [],
          };
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
          status: result.data.topic.status,
          ownerPubkey: result.data.topic.ownerPubkey,
          rootBody:
            result.data.arguments.find(
              (arg) => arg.id === result.data.topic.rootArgumentId,
            )?.body ?? "",
        },
        nodes: result.data.arguments.map((arg) => ({
          id: arg.id,
          parentId: arg.parentId,
          label: toLabel(arg),
        })),
        arguments: result.data.arguments,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, depth, refreshToken]);

  return state;
}
