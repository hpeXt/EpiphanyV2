"use client";

import { useEffect, useRef } from "react";

import { zSseEnvelope, type SseEnvelope } from "@epiphany/shared-contracts";

import { getApiBaseUrl } from "@/lib/apiClient";
import { createLocalStorageTopicAccessKeyStore } from "@/lib/topicAccessKeyStore";

type Options = {
  topicId: string;
  debounceMs?: number;
  onInvalidation: (event: SseEnvelope) => void;
  onReloadRequired?: (event: Extract<SseEnvelope, { event: "reload_required" }>) => void;
};

export function useTopicSse(options: Options) {
  const debounceMs = options.debounceMs ?? 3000;
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return;

    let accessKey: string | null = null;
    try {
      accessKey = createLocalStorageTopicAccessKeyStore().get(options.topicId);
    } catch {
      accessKey = null;
    }

    const query = accessKey ? `?k=${encodeURIComponent(accessKey)}` : "";
    const url = `${baseUrl}/v1/sse/${encodeURIComponent(options.topicId)}${query}`;
    const source = new EventSource(url);

    function scheduleInvalidation(envelope: SseEnvelope) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        options.onInvalidation(envelope);
      }, debounceMs);
    }

    function onMessage(event: MessageEvent) {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      const envelopeResult = zSseEnvelope.safeParse(parsed);
      if (!envelopeResult.success) return;
      const envelope = envelopeResult.data;

      if (envelope.event === "reload_required") {
        options.onReloadRequired?.(envelope);
        return;
      }

      scheduleInvalidation(envelope);
    }

    source.addEventListener("message", onMessage);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      source.removeEventListener("message", onMessage);
      source.close();
    };
  }, [options.topicId, options.onInvalidation, options.onReloadRequired, debounceMs]);
}
