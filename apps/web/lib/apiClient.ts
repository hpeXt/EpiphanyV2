import {
  zCreateTopicResponse,
  zArgumentChildrenResponse,
  zArgumentResponse,
  zEditArgumentResponse,
  zBatchBalanceResponse,
  zCreateArgumentResponse,
  zConsensusReportLatestResponse,
  zErrorResponse,
  zClusterMap,
  zLedgerMe,
  zListTopicsResponse,
  zSetVotesResponse,
  zSetTopicProfileMeResponse,
  zTopicCommandResponse,
  zStakesMeResponse,
  zTopicTreeResponse,
  type BatchBalanceRequestItem,
  type CreateArgumentRequest,
  type CreateTopicRequest,
  type EditArgumentRequest,
  type SetVotesRequest,
  type SetTopicProfileMeRequest,
  type TopicCommand,
} from "@epiphany/shared-contracts";
import type { z } from "zod";

import { createLocalStorageKeyStore, createV1Signer, type Signer, type SignedHeadersV1 } from "@/lib/signing";
import { createLocalStorageTopicAccessKeyStore, type TopicAccessKeyStore } from "@/lib/topicAccessKeyStore";

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

// Lazy-initialized default signer (only available on client-side)
let _defaultSigner: Signer | null = null;
function getDefaultSigner(): Signer | null {
  if (typeof window === "undefined") {
    // Server-side: no signer available
    return null;
  }

  let keyStore: ReturnType<typeof createLocalStorageKeyStore>;
  try {
    keyStore = createLocalStorageKeyStore();
  } catch {
    return null;
  }

  try {
    const seed = keyStore.getMasterSeedHex();
    if (!seed) return null;
  } catch {
    return null;
  }

  _defaultSigner ??= createV1Signer(keyStore);
  return _defaultSigner;
}

let _topicAccessKeyStore: TopicAccessKeyStore | null = null;
function getTopicAccessKeyStore(): TopicAccessKeyStore | null {
  if (typeof window === "undefined") return null;
  if (!_topicAccessKeyStore) {
    _topicAccessKeyStore = createLocalStorageTopicAccessKeyStore();
  }
  return _topicAccessKeyStore;
}

function getTopicAccessKeyHeaders(topicId: string): Record<string, string> {
  const store = getTopicAccessKeyStore();
  if (!store) return {};
  const accessKey = store.get(topicId);
  if (!accessKey) return {};
  return { "x-topic-access-key": accessKey };
}

/**
 * Build batch-balance request items with per-topic signatures
 * Each item is signed with the keypair derived for that specific topic
 *
 * @see docs/stage01/api-contract.md#3.10
 */
export async function buildBatchBalanceItems(
  topicIds: string[],
  signer?: Signer,
): Promise<BatchBalanceRequestItem[]> {
  const effectiveSigner = signer ?? getDefaultSigner();
  if (!effectiveSigner) {
    console.error("buildBatchBalanceItems called without signer on server");
    return [];
  }
  if (topicIds.length === 0) return [];

  const items: BatchBalanceRequestItem[] = [];

  for (const topicId of topicIds) {
    const encodedTopicId = encodeURIComponent(topicId);
    const path = `/v1/topics/${encodedTopicId}/ledger/me`;

    // Sign as if it were a GET request to ledger/me (empty body)
    const headers: SignedHeadersV1 = await effectiveSigner.signV1(topicId, {
      method: "GET",
      path,
      rawBody: null,
    });

    items.push({
      topicId,
      pubkey: headers["X-Pubkey"],
      timestamp: Number(headers["X-Timestamp"]),
      nonce: headers["X-Nonce"],
      signature: headers["X-Signature"],
    });
  }

  return items;
}

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

  let signedHeaders: SignedHeadersV1;
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
  // Get signer lazily - deps.signer takes precedence, then default signer
  const getSigner = (): Signer | null => deps?.signer ?? getDefaultSigner();

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
      const signer = getSigner();
      const encodedTopicId = encodeURIComponent(topicId);
      const params = new URLSearchParams({ depth: String(depth) });
      const path = `/v1/topics/${encodedTopicId}/tree?${params.toString()}`;
      const accessKeyHeaders = getTopicAccessKeyHeaders(topicId);

      if (signer) {
        return requestJsonSigned(
          signer,
          topicId,
          path,
          { method: "GET", headers: accessKeyHeaders },
          zTopicTreeResponse,
        );
      }

      return requestJson(path, { method: "GET", headers: accessKeyHeaders }, zTopicTreeResponse);
    },
    /**
     * God View semantic map (public read)
     * @see docs/stage01/api-contract.md#3.11
     */
    getClusterMap(topicId: string) {
      const signer = getSigner();
      const encodedTopicId = encodeURIComponent(topicId);
      const path = `/v1/topics/${encodedTopicId}/cluster-map`;
      const accessKeyHeaders = getTopicAccessKeyHeaders(topicId);

      if (signer) {
        return requestJsonSigned(
          signer,
          topicId,
          path,
          { method: "GET", headers: accessKeyHeaders },
          zClusterMap,
        );
      }

      return requestJson(path, { method: "GET", headers: accessKeyHeaders }, zClusterMap);
    },
    getArgumentChildren(input: {
      topicId?: string;
      argumentId: string;
      orderBy: "totalVotes_desc" | "createdAt_desc";
      limit: number;
      beforeId?: string;
    }) {
      const signer = input.topicId ? getSigner() : null;
      const encodedArgumentId = encodeURIComponent(input.argumentId);
      const params = new URLSearchParams({
        orderBy: input.orderBy,
        limit: String(input.limit),
      });
      if (input.beforeId) params.set("beforeId", input.beforeId);

      const path = `/v1/arguments/${encodedArgumentId}/children?${params.toString()}`;

      if (input.topicId) {
        const accessKeyHeaders = getTopicAccessKeyHeaders(input.topicId);
        if (signer) {
          return requestJsonSigned(
            signer,
            input.topicId,
            path,
            { method: "GET", headers: accessKeyHeaders },
            zArgumentChildrenResponse,
          );
        }
        return requestJson(path, { method: "GET", headers: accessKeyHeaders }, zArgumentChildrenResponse);
      }

      return requestJson(path, { method: "GET" }, zArgumentChildrenResponse);
    },
    /**
     * Argument detail (public read)
     * @see docs/stage01/api-contract.md#3.5.1
     */
    getArgument(argumentId: string, topicId?: string) {
      const signer = topicId ? getSigner() : null;
      const encodedArgumentId = encodeURIComponent(argumentId);
      const path = `/v1/arguments/${encodedArgumentId}`;

      if (topicId) {
        const accessKeyHeaders = getTopicAccessKeyHeaders(topicId);
        if (signer) {
          return requestJsonSigned(
            signer,
            topicId,
            path,
            { method: "GET", headers: accessKeyHeaders },
            zArgumentResponse,
          );
        }
        return requestJson(path, { method: "GET", headers: accessKeyHeaders }, zArgumentResponse);
      }

      return requestJson(path, { method: "GET" }, zArgumentResponse);
    },
    editArgument(topicId: string, argumentId: string, input: EditArgumentRequest): Promise<ApiResult<z.infer<typeof zEditArgumentResponse>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedArgumentId = encodeURIComponent(argumentId);
      const body = JSON.stringify(input);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/arguments/${encodedArgumentId}/edit`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...getTopicAccessKeyHeaders(topicId) },
          body,
        },
        zEditArgumentResponse,
      );
    },
    getLatestConsensusReport(topicId: string) {
      const signer = getSigner();
      const encodedTopicId = encodeURIComponent(topicId);
      const path = `/v1/topics/${encodedTopicId}/consensus-report/latest`;
      const accessKeyHeaders = getTopicAccessKeyHeaders(topicId);

      if (signer) {
        return requestJsonSigned(
          signer,
          topicId,
          path,
          { method: "GET", headers: accessKeyHeaders },
          zConsensusReportLatestResponse,
        );
      }

      return requestJson(path, { method: "GET", headers: accessKeyHeaders }, zConsensusReportLatestResponse);
    },
    getLedgerMe(topicId: string): Promise<ApiResult<z.infer<typeof zLedgerMe>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedTopicId = encodeURIComponent(topicId);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/ledger/me`,
        { method: "GET", headers: getTopicAccessKeyHeaders(topicId) },
        zLedgerMe,
      );
    },
    setTopicProfileMe(
      topicId: string,
      input: SetTopicProfileMeRequest,
    ): Promise<ApiResult<z.infer<typeof zSetTopicProfileMeResponse>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedTopicId = encodeURIComponent(topicId);
      const body = JSON.stringify(input);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/profile/me`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...getTopicAccessKeyHeaders(topicId) },
          body,
        },
        zSetTopicProfileMeResponse,
      );
    },
    createArgument(topicId: string, input: CreateArgumentRequest): Promise<ApiResult<z.infer<typeof zCreateArgumentResponse>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedTopicId = encodeURIComponent(topicId);
      const body = JSON.stringify(input);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/arguments`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...getTopicAccessKeyHeaders(topicId) },
          body,
        },
        zCreateArgumentResponse,
      );
    },
    setVotes(topicId: string, argumentId: string, input: SetVotesRequest): Promise<ApiResult<z.infer<typeof zSetVotesResponse>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedArgumentId = encodeURIComponent(argumentId);
      const body = JSON.stringify(input);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/arguments/${encodedArgumentId}/votes`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...getTopicAccessKeyHeaders(topicId) },
          body,
        },
        zSetVotesResponse,
      );
    },
    executeTopicCommand(topicId: string, command: TopicCommand, extraHeaders?: Record<string, string>): Promise<ApiResult<z.infer<typeof zTopicCommandResponse>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedTopicId = encodeURIComponent(topicId);
      const body = JSON.stringify(command);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...getTopicAccessKeyHeaders(topicId), ...(extraHeaders ?? {}) },
          body,
        },
        zTopicCommandResponse,
      );
    },
    /**
     * Get stakes for current identity in a topic
     * @see docs/stage01/api-contract.md#3.9
     */
    getStakesMe(topicId: string): Promise<ApiResult<z.infer<typeof zStakesMeResponse>>> {
      const signer = getSigner();
      if (!signer) {
        return Promise.resolve({
          ok: false,
          error: { kind: "config", message: "No signer available (server-side)" },
        });
      }
      const encodedTopicId = encodeURIComponent(topicId);
      return requestJsonSigned(
        signer,
        topicId,
        `/v1/topics/${encodedTopicId}/stakes/me`,
        { method: "GET", headers: getTopicAccessKeyHeaders(topicId) },
        zStakesMeResponse,
      );
    },
    /**
     * Batch query balances for multiple topics
     * Uses item-level signing (no auth headers on request itself)
     * @see docs/stage01/api-contract.md#3.10
     */
    async batchBalance(topicIds: string[]) {
      if (topicIds.length === 0) {
        return { ok: true as const, data: { results: [] } };
      }

      const signer = getSigner();
      const items = await buildBatchBalanceItems(topicIds, signer ?? undefined);
      if (items.length === 0 && topicIds.length > 0) {
        // Signing failed (server-side)
        return {
          ok: false as const,
          error: { kind: "config" as const, message: "No signer available (server-side)" },
        };
      }
      const body = JSON.stringify({ items });

      return requestJson(
        "/v1/user/batch-balance",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
        zBatchBalanceResponse,
      );
    },
  };
}

export const apiClient = createApiClient();
