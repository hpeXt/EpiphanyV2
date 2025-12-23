process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/epiphany';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// E2E tests create many topics quickly; disable topic-creation rate limit unless explicitly set.
process.env.RISK_RL_CREATE_TOPIC_IP_LIMIT = process.env.RISK_RL_CREATE_TOPIC_IP_LIMIT ?? '0';
