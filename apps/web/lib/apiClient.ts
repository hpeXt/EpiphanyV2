import {
  zCreateTopicResponse,
  zArgumentChildrenResponse,
  zCreateArgumentResponse,
  zErrorResponse,
  zLedgerMe,
  zListTopicsResponse,
  zSetVotesResponse,
  zTopicCommandResponse,
  zTopicTreeResponse,
  type CreateArgumentRequest,
  type CreateTopicRequest,
  type SetVotesRequest,
  type TopicCommand,
} from "@epiphany/shared-contracts";
import type { z } from "zod";

import { createLocalStorageKeyStore, createV1Signer, type Signer } from "@/lib/signing";

export type ApiError =
  | { kind: "config"; message: string }
  | { kind: "network"; message: string }
  | { kind: "http"; message: string; status: number; code?: string }
  | { kind: "parse"; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export function getApiBaseUrl(): string | null {
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

const defaultSigner = createV1Signer(createLocalStorageKeyStore());

async function requestJsonSigned<T>(
  signer: Signer,
  topicId: string,
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  const rawBody = typeof init.body === "string" ? init.body : null;
  const pathWithoutQuery = path.split("?")[0];

  let signedHeaders: Record<string, string>;
  try {
    signedHeaders = await signer.signV1(topicId, { method, path: pathWithoutQuery, rawBody });
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "config",
        message: error instanceof Error ? error.message : "Signing failed",
      },
    };
  }

  return requestJson(
    path,
    {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...signedHeaders,
      },
    },
    schema,
  );
}

export function createApiClient(deps?: { signer?: Signer }) {
  const signer = deps?.signer ?? defaultSigner;

  return {
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
    getLedgerMe(topicId: string) {
      const encodedTopicId = encodeURIComponent(topicId);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/ledger/me`,
        { method: "GET" },
        zLedgerMe,
      );
    },
    createArgument(topicId: string, input: CreateArgumentRequest) {
      const encodedTopicId = encodeURIComponent(topicId);
      const body = JSON.stringify(input);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/arguments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
        zCreateArgumentResponse,
      );
    },
    setVotes(topicId: string, argumentId: string, input: SetVotesRequest) {
      const encodedArgumentId = encodeURIComponent(argumentId);
      const body = JSON.stringify(input);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/arguments/${encodedArgumentId}/votes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
        zSetVotesResponse,
      );
    },
    executeTopicCommand(topicId: string, command: TopicCommand, extraHeaders?: Record<string, string>) {
      const encodedTopicId = encodeURIComponent(topicId);
      const body = JSON.stringify(command);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
          body,
        },
        zTopicCommandResponse,
      );
    },
  };
}

export const apiClient = createApiClient();
