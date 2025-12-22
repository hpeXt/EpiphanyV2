/**
 * @file ai-provider.ts
 * @description AI Provider interface for stance analysis and embedding generation
 * @see docs/stage01/ai-worker.md#4
 */

/**
 * AI Provider interface for argument analysis
 */
export interface AIProvider {
  /**
   * Get stance score between parent and child argument
   * @param parentText - The parent argument text
   * @param childText - The child argument text (title + body)
   * @returns Stance score in range [-1, 1]
   *   -1 = strong opposition, 0 = neutral, 1 = strong support
   */
  getStance(parentText: string, childText: string): Promise<number>;

  /**
   * Get embedding vector for text
   * @param text - The text to embed (title + body or just body)
   * @returns 4096-dimensional embedding vector
   */
  getEmbedding(text: string): Promise<number[]>;

  /**
   * Get the model identifier used for embeddings
   */
  getEmbeddingModel(): string;
}

/**
 * Result of stance analysis
 */
export interface StanceResult {
  score: number;
  confidence?: number;
}

/**
 * Result of embedding generation
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

/**
 * Analysis result combining stance and embedding
 */
export interface AnalysisResult {
  stanceScore: number;
  embedding: number[];
  embeddingModel: string;
}

/**
 * Validate stance score is in valid range [-1, 1]
 */
export function isValidStanceScore(score: number): boolean {
  return typeof score === 'number' && !Number.isNaN(score) && score >= -1 && score <= 1;
}

/**
 * Validate embedding has correct dimensions
 */
export function isValidEmbedding(embedding: number[], expectedDimensions = 4096): boolean {
  return (
    Array.isArray(embedding) &&
    embedding.length === expectedDimensions &&
    embedding.every((v) => typeof v === 'number' && !Number.isNaN(v))
  );
}
