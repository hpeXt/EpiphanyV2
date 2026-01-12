# Worker

BullMQ consumer process.

## Env

- `DATABASE_URL` (required) — Postgres (Prisma)
- `REDIS_URL` (required) — Redis (BullMQ)
- `PORT` / `WORKER_PORT` (default: `3002`) — worker HTTP port
- `AI_PROVIDER` (default: `mock`) — `mock|openrouter` (openrouter currently falls back to mock)
- `TRANSLATION_PROVIDER` (optional) — `mock|openrouter` (defaults to `AI_PROVIDER` if omitted)
- `TRANSLATION_MODEL` (default: `z-ai/glm-4.7`) — OpenRouter model id
- `TRANSLATION_BUDGET_TOKENS_PER_MONTH` (default: `200000`) — hard monthly token cap (0 disables; -1 unlimited)
- `CLUSTER_ENGINE` (default: `node`) — `node|python`
- `WORKER_DEBUG_TOKEN` (optional) — enables debug enqueue endpoint (see HTTP section)

## HTTP (for acceptance)

- `GET /` / `GET /health` → `{ ok: true }` (503 if Redis/DB unreachable)
- `POST /enqueue-analysis` → enqueue an `ai_argument-analysis` job (debug only; requires `WORKER_DEBUG_TOKEN` + header `x-worker-debug-token`)

## Dev

- Recommended (loads root `.env` via `scripts/dev.mjs`): `pnpm dev` (starts web + api + worker)
- Only worker: `pnpm dev --filter=@epiphany/worker`
- Or: `pnpm -C apps/worker dev` (the worker will auto-load root `.env`)
