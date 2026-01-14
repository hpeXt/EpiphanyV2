/**
 * @file provider-factory.ts
 * @description Factory for creating AI providers based on configuration
 */

import type { AIProvider } from './ai-provider.js';
import { createMockAIProvider } from './mock-ai-provider.js';

export type AIProviderType = 'mock' | 'openrouter';

/**
 * Get the configured AI provider type from environment
 */
export function getAIProviderType(): AIProviderType {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === 'openrouter' || explicit === 'real') return 'openrouter';
  if (explicit === 'mock') return 'mock';

  // Auto-enable real embeddings when OpenRouter is configured, even if
  // AI_PROVIDER isn't explicitly set in `.env`.
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'openrouter';

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
      // TODO: Implement OpenRouter provider (Step 19+)
      console.warn('[worker] OpenRouter provider not yet implemented, falling back to mock');
      return createMockAIProvider({
        shouldSucceed: true,
        delayMs: 100,
      });

    default:
      throw new Error(`Unknown AI provider type: ${providerType}`);
  }
}
