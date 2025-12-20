# Worker

BullMQ consumer process.

## Env

- `REDIS_URL` (required)
- `WORKER_QUEUE_NAME` (default: `dev-ping`)
- `PORT` (default: `3002`)

## HTTP (for acceptance)

- `GET /` / `GET /health` → `{ ok: true }` (503 if Redis unreachable)
- `POST /enqueue-ping` → enqueue a `ping` job

## Dev

- `pnpm -C apps/worker dev`
- `pnpm -C apps/worker enqueue:ping`
