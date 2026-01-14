/**
 * @file provider-factory.ts
 * @description Factory for creating AI providers based on configuration
 */

import type { AIProvider } from './ai-provider.js';
import { createMockAIProvider } from './mock-ai-provider.js';
import { createOpenRouterAIProvider } from './openrouter-ai-provider.js';

export type AIProviderType = 'mock' | 'openrouter';

/**
 * Get the configured AI provider type from environment
 */
export function getAIProviderType(): AIProviderType {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === 'mock') return 'mock';

  const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  if (explicit === 'openrouter' || explicit === 'real') return hasOpenRouterKey ? 'openrouter' : 'mock';

  // Auto-enable real embeddings when OpenRouter is configured, even if
  // AI_PROVIDER isn't explicitly set in `.env`.
  if (hasOpenRouterKey) return 'openrouter';

  return 'mock';
}

/**
 * Create an AI provider based on configuration
 */
export function createAIProvider(): AIProvider {
  const providerType = getAIProviderType();

  console.log(`[worker] Using AI provider: ${providerType}`);

  switch (providerType) {
    case 'mock':
      return createMockAIProvider({
        shouldSucceed: true,
        stanceScore: 0, // Default neutral stance for mock
        delayMs: 100, // Small delay to simulate network
      });

    case 'openrouter':
      return createOpenRouterAIProvider({
        apiKey: process.env.OPENROUTER_API_KEY!.trim(),
        baseUrl: (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, ''),
        embeddingModel: process.env.EMBEDDING_MODEL?.trim() || undefined,
        stanceModel: process.env.STANCE_MODEL?.trim() || undefined,
      });

    default:
      throw new Error(`Unknown AI provider type: ${providerType}`);
  }
}
