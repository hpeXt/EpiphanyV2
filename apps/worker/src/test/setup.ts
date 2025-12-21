/**
 * @file setup.ts
 * @description Test setup for worker integration tests
 */

// Set up test environment variables
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/epiphany';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.AI_PROVIDER = 'mock';
