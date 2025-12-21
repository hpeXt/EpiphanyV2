process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/epiphany';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

