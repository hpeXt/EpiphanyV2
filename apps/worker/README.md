# Worker

BullMQ consumer process.

## Env

- `DATABASE_URL` (required) — Postgres (Prisma)
- `REDIS_URL` (required) — Redis (BullMQ)
- `PORT` / `WORKER_PORT` (default: `3002`) — worker HTTP port
- `AI_PROVIDER` (default: `mock`) — `mock|openrouter` (openrouter currently falls back to mock)
- `TRANSLATION_PROVIDER` (optional) — `mock|openrouter` (auto-detects `openrouter` if `OPENROUTER_API_KEY` is set)
- `TRANSLATION_MODEL` (default: `z-ai/glm-4.7`) — OpenRouter model id
- `TRANSLATION_BUDGET_TOKENS_PER_MONTH` (default: `200000`) — hard monthly token cap (0 disables; -1 unlimited)
- `TRANSLATION_AUTOMATION_ENABLED` (default: `1`) — enables translation backfill + sweeper (topics/arguments/displayName)
- `TRANSLATION_BACKFILL_MODE` (default: `auto`) — `auto|force|disabled`
- `TRANSLATION_SWEEPER_INTERVAL_MS` (default: `300000`) — sweeper interval
- `TRANSLATION_SWEEPER_BATCH_SIZE` (default: `200`) — scan page size
- `TRANSLATION_SWEEPER_ENQUEUE_CONCURRENCY` (default: `10`) — enqueue concurrency
- `TRANSLATION_SWEEPER_RETRY_PENDING_AFTER_MS` (default: `1200000`) — skip re-enqueueing `pending` rows newer than this (retries stale `pending`)
- `TRANSLATION_SWEEPER_RETRY_FAILED_AFTER_MS` (default: `1800000`) — skip re-enqueueing `failed` rows newer than this
- `TRANSLATION_AUTOMATION_ALLOW_MOCK` (default: `0`) — allow automation even when provider is `mock`
- `CLUSTER_ENGINE` (default: `node`) — `node|python`
- `WORKER_DEBUG_TOKEN` (optional) — enables debug enqueue endpoint (see HTTP section)

## HTTP (for acceptance)

- `GET /` / `GET /health` → `{ ok: true }` (503 if Redis/DB unreachable)
  - Includes `providers.translation` + `translation.model` + `translation.budgetTokensPerMonth` for debugging OpenRouter enablement/budget gating.
- `POST /enqueue-analysis` → enqueue an `ai_argument-analysis` job (debug only; requires `WORKER_DEBUG_TOKEN` + header `x-worker-debug-token`)

## Dev

- Recommended (loads root `.env` via `scripts/dev.mjs`): `pnpm dev` (starts web + api + worker)
- Only worker: `pnpm dev --filter=@epiphany/worker`
- Or: `pnpm -C apps/worker dev` (the worker will auto-load root `.env`)
