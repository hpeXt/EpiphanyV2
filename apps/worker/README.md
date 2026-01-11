# Worker

BullMQ consumer process.

## Env

- `DATABASE_URL` (required) — Postgres (Prisma)
- `REDIS_URL` (required) — Redis (BullMQ)
- `PORT` / `WORKER_PORT` (default: `3002`) — worker HTTP port
- `AI_PROVIDER` (default: `mock`) — `mock|openrouter` (openrouter currently falls back to mock)
- `CLUSTER_ENGINE` (default: `node`) — `node|python`
- `WORKER_DEBUG_TOKEN` (optional) — enables debug enqueue endpoint (see HTTP section)

## HTTP (for acceptance)

- `GET /` / `GET /health` → `{ ok: true }` (503 if Redis/DB unreachable)
- `POST /enqueue-analysis` → enqueue an `ai_argument-analysis` job (debug only; requires `WORKER_DEBUG_TOKEN` + header `x-worker-debug-token`)

## Dev

- Recommended (loads root `.env` via `scripts/dev.mjs`): `pnpm dev` (starts web + api + worker)
- Only worker: `pnpm dev --filter=@epiphany/worker`
- Or: `pnpm -C apps/worker dev` (the worker will auto-load root `.env`)
