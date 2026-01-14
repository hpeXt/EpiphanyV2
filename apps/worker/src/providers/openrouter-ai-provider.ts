/**
 * @file openrouter-ai-provider.ts
 * @description OpenRouter AI provider for stance analysis + embedding generation.
 *
 * Uses OpenRouter's OpenAI-compatible endpoints:
 * - POST /chat/completions
 * - POST /embeddings
 */

import type { AIProvider } from './ai-provider.js';

type OpenRouterAIProviderConfig = {
  apiKey: string;
  baseUrl: string;
  embeddingModel: string;
  stanceModel: string;
  embeddingTimeoutMs: number;
  stanceTimeoutMs: number;
  stanceMaxTokens: number;
  stanceTemperature: number;
  maxFetchAttempts: number;
  extraHeaders?: Record<string, string>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout');
}

function formatErrorWithCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as any).cause;
  if (!cause) return err.message;
  return `${err.message}; cause=${cause instanceof Error ? cause.message : String(cause)}`;
}

function getDefaultExtraHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (referer) headers['HTTP-Referer'] = referer;
  const title = process.env.OPENROUTER_TITLE?.trim();
  if (title) headers['X-Title'] = title;
  return headers;
}

export function createOpenRouterAIProvider(input: Partial<OpenRouterAIProviderConfig> & {
  apiKey: string;
  baseUrl: string;
}): AIProvider {
  const maxFetchAttempts = parsePositiveInt(input.maxFetchAttempts, 2);
  const config: OpenRouterAIProviderConfig = {
    apiKey: input.apiKey,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    embeddingModel: input.embeddingModel ?? 'qwen/qwen3-embedding-8b',
    stanceModel: input.stanceModel ?? 'google/gemini-2.5-flash-preview',
    embeddingTimeoutMs: parsePositiveInt(input.embeddingTimeoutMs, 30_000),
    stanceTimeoutMs: parsePositiveInt(input.stanceTimeoutMs, 20_000),
    stanceMaxTokens: parsePositiveInt(input.stanceMaxTokens, 32),
    stanceTemperature: Number.isFinite(Number(input.stanceTemperature)) ? Number(input.stanceTemperature) : 0,
    maxFetchAttempts,
    extraHeaders: input.extraHeaders ?? getDefaultExtraHeaders(),
  };

  return {
    async getStance(parentText: string, childText: string): Promise<number> {
      const systemPrompt = [
        'You are a stance classifier.',
        'Given a PARENT argument and a CHILD argument, output a single number in [-1, 1].',
        '-1 = child strongly opposes parent; 0 = neutral/unclear; 1 = child strongly supports parent.',
        'Output ONLY the number, no extra text.',
      ].join('\n');

      const userPrompt = [
        'PARENT:',
        parentText,
        '',
        'CHILD:',
        childText,
      ].join('\n');

      const { content } = await callOpenRouterChatCompletion({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.stanceModel,
        temperature: config.stanceTemperature,
        maxTokens: config.stanceMaxTokens,
        timeoutMs: config.stanceTimeoutMs,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxFetchAttempts: config.maxFetchAttempts,
        extraHeaders: config.extraHeaders,
      });

      const score = parseStanceScore(content);
      return clamp(score, -1, 1);
    },

    async getEmbedding(text: string): Promise<number[]> {
      const { embedding } = await callOpenRouterEmbeddings({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.embeddingModel,
        input: text,
        timeoutMs: config.embeddingTimeoutMs,
        maxFetchAttempts: config.maxFetchAttempts,
        extraHeaders: config.extraHeaders,
      });
      return embedding;
    },

    getEmbeddingModel(): string {
      return config.embeddingModel;
    },
  };
}

function parseStanceScore(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Empty stance response');

  // Try strict JSON first (in case the model follows a structured response).
  try {
    const json = JSON.parse(trimmed);
    const candidate = (json as any)?.stanceScore ?? (json as any)?.stance ?? (json as any)?.score;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // ignore
  }

  const match = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    throw new Error(`Failed to parse stance score from: ${trimmed.slice(0, 120)}`);
  }
  const value = Number(match[0]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid stance score: ${match[0]}`);
  }
  return value;
}

async function callOpenRouterChatCompletion(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  maxFetchAttempts: number;
  extraHeaders?: Record<string, string>;
}): Promise<{ content: string; usedModel: string; requestId?: string }> {
  const url = `${params.baseUrl}/chat/completions`;
  const baseRetryDelayMs = 750;

  for (let attempt = 1; attempt <= params.maxFetchAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
            ...(params.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model: params.model,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            messages: params.messages,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (attempt < params.maxFetchAttempts && isRetryableNetworkError(err)) {
          console.warn(
            `[ai-provider] OpenRouter network error (attempt ${attempt}/${params.maxFetchAttempts}) url=${url} model=${params.model}: ${formatErrorWithCause(err)}`,
          );
          await sleep(baseRetryDelayMs * attempt);
          continue;
        }

        throw new Error(`OpenRouter network error url=${url} model=${params.model}: ${formatErrorWithCause(err)}`, {
          cause: err instanceof Error ? err : undefined,
        });
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const message = `OpenRouter request failed url=${url} model=${params.model}: ${response.status} ${text || response.statusText}`;

        if (attempt < params.maxFetchAttempts && isRetryableHttpStatus(response.status)) {
          console.warn(`[ai-provider] ${message} (attempt ${attempt}/${params.maxFetchAttempts}) retrying...`);
          await sleep(baseRetryDelayMs * attempt);
          continue;
        }

        throw new Error(message);
      }

      const json = (await response.json()) as any;
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`OpenRouter returned empty content url=${url} model=${params.model}`);
      }

      const usedModel = typeof json?.model === 'string' ? json.model : params.model;
      const requestId = typeof json?.id === 'string' ? json.id : undefined;
      return { content, usedModel, requestId };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`OpenRouter request failed after ${params.maxFetchAttempts} attempts url=${url} model=${params.model}`);
}

async function callOpenRouterEmbeddings(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  input: string;
  timeoutMs: number;
  maxFetchAttempts: number;
  extraHeaders?: Record<string, string>;
}): Promise<{ embedding: number[]; usedModel: string; requestId?: string }> {
  const url = `${params.baseUrl}/embeddings`;
  const baseRetryDelayMs = 750;

  for (let attempt = 1; attempt <= params.maxFetchAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
            ...(params.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model: params.model,
            input: params.input,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (attempt < params.maxFetchAttempts && isRetryableNetworkError(err)) {
          console.warn(
            `[ai-provider] OpenRouter network error (attempt ${attempt}/${params.maxFetchAttempts}) url=${url} model=${params.model}: ${formatErrorWithCause(err)}`,
          );
          await sleep(baseRetryDelayMs * attempt);
          continue;
        }

        throw new Error(`OpenRouter network error url=${url} model=${params.model}: ${formatErrorWithCause(err)}`, {
          cause: err instanceof Error ? err : undefined,
        });
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const message = `OpenRouter embeddings failed url=${url} model=${params.model}: ${response.status} ${text || response.statusText}`;

        if (attempt < params.maxFetchAttempts && isRetryableHttpStatus(response.status)) {
          console.warn(`[ai-provider] ${message} (attempt ${attempt}/${params.maxFetchAttempts}) retrying...`);
          await sleep(baseRetryDelayMs * attempt);
          continue;
        }

        throw new Error(message);
      }

      const json = (await response.json()) as any;
      const embedding = json?.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error(`OpenRouter embeddings response missing data[0].embedding url=${url} model=${params.model}`);
      }

      const usedModel = typeof json?.model === 'string' ? json.model : params.model;
      const requestId = typeof json?.id === 'string' ? json.id : undefined;

      return {
        embedding: embedding.map((v: unknown) => Number(v)),
        usedModel,
        requestId,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`OpenRouter embeddings failed after ${params.maxFetchAttempts} attempts url=${url} model=${params.model}`);
}

