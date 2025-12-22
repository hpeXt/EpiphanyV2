"use client";

import { useEffect, useState } from "react";

import type { ClusterMap } from "@epiphany/shared-contracts";

import { apiClient } from "@/lib/apiClient";

type UseClusterMapState =
  | { status: "loading"; errorMessage: ""; data: null }
  | { status: "error"; errorMessage: string; data: null }
  | { status: "success"; errorMessage: ""; data: ClusterMap };

export function useClusterMap(topicId: string, refreshToken = 0): UseClusterMapState {
  const [state, setState] = useState<UseClusterMapState>({
    status: "loading",
    errorMessage: "",
    data: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState((prev) => {
      if (prev.status === "success" && prev.data.topicId === topicId) {
        return prev;
      }
      return { status: "loading", errorMessage: "", data: null };
    });

    (async () => {
      const result = await apiClient.getClusterMap(topicId);
      if (cancelled) return;

      if (!result.ok) {
        setState({ status: "error", errorMessage: result.error.message, data: null });
        return;
      }

      setState({ status: "success", errorMessage: "", data: result.data });
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, refreshToken]);

  return state;
}

