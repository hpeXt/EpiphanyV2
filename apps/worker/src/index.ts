/**
 * @file index.ts
 * @description Worker module exports
 */

export { processArgumentAnalysis } from './processors/argument-analysis.js';
export type { ProcessArgumentAnalysisParams, ProcessResult } from './processors/argument-analysis.js';

export type { AIProvider } from './providers/ai-provider.js';
export { isValidStanceScore, isValidEmbedding } from './providers/ai-provider.js';

export { createMockAIProvider } from './providers/mock-ai-provider.js';
export type { MockAIProviderOptions } from './providers/mock-ai-provider.js';

export { createAIProvider, getAIProviderType } from './providers/provider-factory.js';
export type { AIProviderType } from './providers/provider-factory.js';
