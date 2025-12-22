/**
 * @file mock-ai-provider.ts
 * @description Mock AI provider for testing and development
 * @see docs/stage01/ai-worker.md#4
 *
 * Uses AI_PROVIDER=mock to avoid network dependencies during development.
 */

import type { AIProvider } from './ai-provider.js';

const EMBEDDING_DIMENSIONS = 4096;
const MOCK_EMBEDDING_MODEL = 'mock-embedding-model';

export interface MockAIProviderOptions {
  /**
   * Whether the provider should succeed or fail
   */
  shouldSucceed?: boolean;

  /**
   * Custom stance score to return (default: 0)
   */
  stanceScore?: number;

  /**
   * Custom embedding to return (default: generated from text hash)
   */
  embedding?: number[];

  /**
   * Error message when failing
   */
  errorMessage?: string;

  /**
   * Artificial delay in milliseconds
   */
  delayMs?: number;
}

/**
 * Create a mock AI provider for testing
 */
export function createMockAIProvider(options: MockAIProviderOptions = {}): AIProvider {
  const {
    shouldSucceed = true,
    stanceScore = 0,
    embedding,
    errorMessage = 'Mock provider error',
    delayMs = 0,
  } = options;

  return {
    async getStance(parentText: string, childText: string): Promise<number> {
      if (delayMs > 0) {
        await delay(delayMs);
      }

      if (!shouldSucceed) {
        throw new Error(errorMessage);
      }

      // Return the configured stance score
      return stanceScore;
    },

    async getEmbedding(text: string): Promise<number[]> {
      if (delayMs > 0) {
        await delay(delayMs);
      }

      if (!shouldSucceed) {
        throw new Error(errorMessage);
      }

      // Return custom embedding or generate deterministic one from text
      if (embedding) {
        return embedding;
      }

      return generateDeterministicEmbedding(text);
    },

    getEmbeddingModel(): string {
      return MOCK_EMBEDDING_MODEL;
    },
  };
}

/**
 * Generate a deterministic embedding from text for testing consistency
 * Uses a simple hash-based approach to ensure same input -> same output
 */
function generateDeterministicEmbedding(text: string): number[] {
  const embedding = new Array<number>(EMBEDDING_DIMENSIONS);

  // Simple deterministic pseudo-random based on text
  let seed = hashCode(text);

  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    // LCG pseudo-random
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // Normalize to [-1, 1]
    embedding[i] = (seed / 0x7fffffff) * 2 - 1;
  }

  // Normalize to unit length
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}

/**
 * Simple hash function for deterministic seeding
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default mock provider instance (successful by default)
 */
export const defaultMockProvider = createMockAIProvider();
