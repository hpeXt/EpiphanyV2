"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiClient } from "@/lib/apiClient";

export type ChildrenOrderBy = "totalVotes_desc" | "createdAt_desc";

export type DialogueItem = {
  id: string;
  label: string;
};

type UseChildrenState =
  | {
      status: "idle";
      errorMessage: "";
      items: [];
      nextBeforeId: null;
      isLoadingMore: false;
    }
  | {
      status: "loading";
      errorMessage: "";
      items: DialogueItem[];
      nextBeforeId: string | null;
      isLoadingMore: boolean;
    }
  | {
      status: "error";
      errorMessage: string;
      items: DialogueItem[];
      nextBeforeId: string | null;
      isLoadingMore: boolean;
    }
  | {
      status: "success";
      errorMessage: "";
      items: DialogueItem[];
      nextBeforeId: string | null;
      isLoadingMore: boolean;
    };

function toLabel(input: { title: string | null; body: string; id: string }): string {
  if (input.title) return input.title;
  const trimmed = input.body.trim();
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return input.id;
}

function dedupeAppend(existing: DialogueItem[], incoming: DialogueItem[]): DialogueItem[] {
  if (incoming.length === 0) return existing;

  const seen = new Set(existing.map((item) => item.id));
  const next: DialogueItem[] = [...existing];

  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }

  return next;
}

export function useChildren(input: {
  parentArgumentId: string | null;
  orderBy: ChildrenOrderBy;
  limit?: number;
}) {
  const limit = input.limit ?? 30;
  const [state, setState] = useState<UseChildrenState>({
    status: "idle",
    errorMessage: "",
    items: [],
    nextBeforeId: null,
    isLoadingMore: false,
  });

  useEffect(() => {
    if (!input.parentArgumentId) {
      setState({
        status: "idle",
        errorMessage: "",
        items: [],
        nextBeforeId: null,
        isLoadingMore: false,
      });
      return;
    }

    let cancelled = false;

    setState({
      status: "loading",
      errorMessage: "",
      items: [],
      nextBeforeId: null,
      isLoadingMore: false,
    });

    (async () => {
      const result = await apiClient.getArgumentChildren({
        argumentId: input.parentArgumentId,
        orderBy: input.orderBy,
        limit,
      });

      if (cancelled) return;

      if (!result.ok) {
        setState({
          status: "error",
          errorMessage: result.error.message,
          items: [],
          nextBeforeId: null,
          isLoadingMore: false,
        });
        return;
      }

      setState({
        status: "success",
        errorMessage: "",
        items: result.data.items.map((item) => ({
          id: item.id,
          label: toLabel(item),
        })),
        nextBeforeId: result.data.nextBeforeId,
        isLoadingMore: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [input.parentArgumentId, input.orderBy, limit]);

  const hasMore = useMemo(() => state.nextBeforeId !== null, [state.nextBeforeId]);

  const loadMore = useCallback(async () => {
    if (!input.parentArgumentId) return;
    if (!state.nextBeforeId) return;
    if (state.isLoadingMore) return;
    if (state.status !== "success") return;

    setState((prev) => ({
      ...prev,
      isLoadingMore: true,
    }));

    const result = await apiClient.getArgumentChildren({
      argumentId: input.parentArgumentId,
      orderBy: input.orderBy,
      limit,
      beforeId: state.nextBeforeId,
    });

    if (!result.ok) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: result.error.message,
        isLoadingMore: false,
      }));
      return;
    }

    const incoming = result.data.items.map((item) => ({
      id: item.id,
      label: toLabel(item),
    }));

    setState((prev) => ({
      ...prev,
      status: "success",
      errorMessage: "",
      items: dedupeAppend(prev.items, incoming),
      nextBeforeId: result.data.nextBeforeId,
      isLoadingMore: false,
    }));
  }, [
    input.parentArgumentId,
    input.orderBy,
    limit,
    state.isLoadingMore,
    state.nextBeforeId,
    state.status,
  ]);

  return {
    ...state,
    hasMore,
    loadMore,
  };
}

