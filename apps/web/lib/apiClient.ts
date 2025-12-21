import {
  zCreateTopicResponse,
  zArgumentChildrenResponse,
  zErrorResponse,
  zListTopicsResponse,
  zTopicTreeResponse,
  type CreateTopicRequest,
} from "@epiphany/shared-contracts";
import type { z } from "zod";

export type ApiError =
  | { kind: "config"; message: string }
  | { kind: "network"; message: string }
  | { kind: "http"; message: string; status: number; code?: string }
  | { kind: "parse"; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function getApiBaseUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<
  | { ok: true; json: unknown }
  | { ok: false; error: ApiError }
> {
  try {
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    return { ok: true, json };
  } catch {
    return { ok: false, error: { kind: "parse", message: "Invalid JSON from server" } };
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<ApiResult<T>> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      error: {
        kind: "config",
        message: "Missing NEXT_PUBLIC_API_URL",
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return { ok: false, error: { kind: "network", message: "Network error" } };
  }

  const jsonResult = await readJson(response);
  if (!jsonResult.ok) return jsonResult;
  const { json } = jsonResult;

  if (!response.ok) {
    const parsedError = zErrorResponse.safeParse(json);
    if (parsedError.success) {
      return {
        ok: false,
        error: {
          kind: "http",
          status: response.status,
          code: parsedError.data.error.code,
          message: parsedError.data.error.message,
        },
      };
    }

    return {
      ok: false,
      error: { kind: "http", status: response.status, message: "Request failed" },
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error("Contract parse failed", parsed.error.flatten(), json);
    return {
      ok: false,
      error: { kind: "parse", message: "Unexpected server response" },
    };
  }

  return { ok: true, data: parsed.data };
}

export const apiClient = {
  listTopics() {
    return requestJson("/v1/topics", { method: "GET" }, zListTopicsResponse);
  },
  createTopic(input: CreateTopicRequest) {
    return requestJson(
      "/v1/topics",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      zCreateTopicResponse,
    );
  },
  getTopicTree(topicId: string, depth = 3) {
    const encodedTopicId = encodeURIComponent(topicId);
    const params = new URLSearchParams({ depth: String(depth) });
    return requestJson(
      `/v1/topics/${encodedTopicId}/tree?${params.toString()}`,
      { method: "GET" },
      zTopicTreeResponse,
    );
  },
  getArgumentChildren(input: {
    argumentId: string;
    orderBy: "totalVotes_desc" | "createdAt_desc";
    limit: number;
    beforeId?: string;
  }) {
    const encodedArgumentId = encodeURIComponent(input.argumentId);
    const params = new URLSearchParams({
      orderBy: input.orderBy,
      limit: String(input.limit),
    });
    if (input.beforeId) params.set("beforeId", input.beforeId);

    return requestJson(
      `/v1/arguments/${encodedArgumentId}/children?${params.toString()}`,
      { method: "GET" },
      zArgumentChildrenResponse,
    );
  },
};
