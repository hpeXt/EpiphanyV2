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
   * descendants via `/v1/arguments/:argumentId/children` until the tree is complete.
   */
  loadFullTree?: boolean;
  /**
   * Page size for children fetches (1..100).
   */
  childrenPageSize?: number;
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
    const childrenPageSize = Math.max(1, Math.min(100, options?.childrenPageSize ?? 100));
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

      const expanded = new Set<string>();
      const childrenByParent = new Map<string, string[]>();
      for (const arg of baseArguments) {
        if (!arg.parentId) continue;
        const list = childrenByParent.get(arg.parentId) ?? [];
        list.push(arg.id);
        childrenByParent.set(arg.parentId, list);
      }

      const depthById = new Map<string, number>();
      const rootId = baseTopic.rootArgumentId;
      depthById.set(rootId, 1);
      let frontier = [rootId];
      let maxDepth = 1;

      while (frontier.length) {
        const next: string[] = [];
        for (const parentId of frontier) {
          const parentDepth = depthById.get(parentId) ?? 1;
          const children = childrenByParent.get(parentId) ?? [];
          for (const childId of children) {
            if (depthById.has(childId)) continue;
            const childDepth = parentDepth + 1;
            depthById.set(childId, childDepth);
            next.push(childId);
            if (childDepth > maxDepth) maxDepth = childDepth;
          }
        }
        frontier = next;
      }

      const queue = Array.from(depthById.entries())
        .filter(([, depth]) => depth === maxDepth)
        .map(([id]) => id);

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

      const fetchAllChildren = async (parentArgumentId: string) => {
        const items: Argument[] = [];
        let beforeId: string | undefined = undefined;
        while (!cancelled) {
          const res = await apiClient.getArgumentChildren({
            topicId,
            argumentId: parentArgumentId,
            orderBy: "createdAt_desc",
            limit: childrenPageSize,
            ...(beforeId ? { beforeId } : {}),
          });
          if (cancelled) return items;
          if (!res.ok) return items;

          items.push(...res.data.items);
          if (!res.data.nextBeforeId) return items;
          beforeId = res.data.nextBeforeId;
        }
        return items;
      };

      while (!cancelled && queue.length > 0 && loadedById.size < maxArguments) {
        const parentId = queue.shift();
        if (!parentId) continue;
        if (expanded.has(parentId)) continue;
        expanded.add(parentId);

        const children = await fetchAllChildren(parentId);
        if (cancelled) return;
        if (!children.length) continue;

        let added = 0;
        for (const child of children) {
          if (loadedById.has(child.id)) continue;
          loadedById.set(child.id, child);
          queue.push(child.id);
          added += 1;
        }

        if (added > 0) {
          flushState();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, depth, refreshToken, options?.loadFullTree, options?.childrenPageSize, options?.maxArguments]);

  return state;
}
