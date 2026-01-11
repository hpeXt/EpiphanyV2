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
  visibility: "public" | "unlisted" | "private";
  rootBody: string;
};

type Options = {
  /**
   * When enabled, starts from `depth` and then incrementally fetches all remaining
   * arguments via `/v1/topics/:topicId/arguments` until the tree is complete.
   */
  loadFullTree?: boolean;
  /**
   * Page size for topic argument fetches (1..1000).
   */
  pageSize?: number;
  /**
   * Safety cap to avoid runaway loading for extremely large topics.
   */
  maxArguments?: number;
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
  options?: Options,
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
    const loadFullTree = options?.loadFullTree ?? false;
    const pageSize = Math.max(1, Math.min(1000, options?.pageSize ?? 500));
    const maxArguments = Math.max(100, options?.maxArguments ?? 10_000);

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

      const baseArguments = result.data.arguments;
      const baseTopic = {
        id: result.data.topic.id,
        title: result.data.topic.title,
        rootArgumentId: result.data.topic.rootArgumentId,
        status: result.data.topic.status,
        ownerPubkey: result.data.topic.ownerPubkey,
        visibility: result.data.topic.visibility,
        rootBody: baseArguments.find((arg) => arg.id === result.data.topic.rootArgumentId)?.body ?? "",
      } satisfies TopicHeader;

      setState({
        status: "success",
        errorMessage: "",
        topic: baseTopic,
        nodes: baseArguments.map((arg) => ({
          id: arg.id,
          parentId: arg.parentId,
          label: toLabel(arg),
        })),
        arguments: baseArguments,
      });

      if (!loadFullTree) return;

      const loadedById = new Map<string, Argument>();
      for (const arg of baseArguments) {
        loadedById.set(arg.id, arg);
      }

      const flushState = () => {
        const merged = Array.from(loadedById.values());
        setState((prev) => {
          if (prev.status !== "success") return prev;
          if (prev.topic.id !== baseTopic.id) return prev;
          return {
            ...prev,
            nodes: merged.map((arg) => ({
              id: arg.id,
              parentId: arg.parentId,
              label: toLabel(arg),
            })),
            arguments: merged,
          };
        });
      };

      const seenCursors = new Set<string>();
      let beforeId: string | undefined = undefined;

      while (!cancelled && loadedById.size < maxArguments) {
        const res = await apiClient.listTopicArguments({
          topicId,
          limit: pageSize,
          ...(beforeId ? { beforeId } : {}),
        });

        if (cancelled) return;
        if (!res.ok) return;

        let added = 0;
        for (const arg of res.data.items) {
          if (loadedById.has(arg.id)) continue;
          loadedById.set(arg.id, arg);
          added += 1;
        }

        if (added > 0) flushState();

        const nextCursor = res.data.nextBeforeId;
        if (!nextCursor) return;
        if (seenCursors.has(nextCursor)) return;
        seenCursors.add(nextCursor);
        beforeId = nextCursor;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, depth, refreshToken, options?.loadFullTree, options?.pageSize, options?.maxArguments]);

  return state;
}
