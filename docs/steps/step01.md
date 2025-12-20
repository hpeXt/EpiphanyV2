# Step 01 — 本地开发环境与 Repo Ready（M0-基础）

## 目标

把后续迭代需要的“地基”先跑通：本地可一键启动 Postgres/Redis，`apps/api`/`apps/web` 能跑起来并读到环境变量。

## 依赖

- 无

## 范围（本 step 做/不做）

- 做：
  - 补齐 `docker-compose`：PostgreSQL + Redis
  - 提供 `.env.example`（API/Web/DB/Redis）
  - API 提供最小可验收的健康检查（至少能验证 DB/Redis 可连通）
- 不做：
  - 业务表结构（Prisma schema/migrations 放到 Step 03）
  - 任何业务 API（Topic/Argument/QV 等）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite A — 基础健康检查）。

### API（e2e / smoke）

- [ ] `GET /health`：返回 `200`，响应体为 JSON，且包含 `db: "ok"`、`redis: "ok"`（或等价字段）
- [ ] Health 响应不得泄露敏感信息（例如 `DATABASE_URL`、密码、内部 IP）
- [ ] 当 Postgres/Redis 不可用时：`/health` 返回非 `200`（或 `db:"fail"/redis:"fail"`，但要在测试里锁死口径）

### 服务器验收（Smoke，黑盒）

通过 Coolify CLI 围绕同一台验收机执行（运行手册：`docs/coolify-acceptance.md`）。

- [ ] `coolify context verify --context <ctx>`
- [ ] Postgres/Redis 资源处于可用状态（`coolify database get <postgres_uuid>` / `coolify database get <redis_uuid>`）
- [ ] 部署 API：`coolify deploy name <api_app_name>`
- [ ] API 运行正常：`coolify app logs <api_app_uuid> -n 200` 无启动错误
- [ ] 对外冒烟：`curl -fsS "$API_BASE_URL/health"` 返回 `db:"ok"`、`redis:"ok"`
- [ ] 故意让 DB 或 Redis 不可用（停服务/改环境变量）时：`curl -fsS "$API_BASE_URL/health"` 必须失败（防止“假绿”）

建议落点：`apps/api/test/health.e2e-spec.ts`（沿用现有 Jest e2e 结构）。

## 2) Green：最小实现（让测试通过）

- `docker-compose.yml` 增加服务：
  - `postgres`：开启 5432，初始化用户/库（用于后续 Prisma）
  - `redis`：开启 6379
- 根目录增加 `.env.example`（最少包含）：
  - `DATABASE_URL=postgresql://...`
  - `REDIS_URL=redis://...`
  - `API_PORT=3001`
  - `NEXT_PUBLIC_API_URL=http://localhost:3001`
- `apps/api`：
  - 增加 Health Controller/Route（`/health`）
  - 增加 DB/Redis 连通性探测（可以是最简单的 `SELECT 1` + `PING`）

## 3) Refactor：模块化与收敛

- [ ] 把 DB/Redis 探测封装成可注入 service（避免 controller 里直接写连接逻辑）
- [ ] 约定统一的配置读取方式（`.env` → `process.env`；具体配置模块可后置）

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `curl -fsS "$API_BASE_URL/health"`
  - 本地快速反馈（可选）：
    - `cp .env.example .env`
    - `docker compose up -d postgres redis`
    - `pnpm -C apps/api test:e2e`
    - `pnpm dev`
- 验收点
  - [ ] API `/health` 通过（含 DB/Redis 探测）
  - [ ] Web 可启动（页面可暂时空）
