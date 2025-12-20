# Step 01 — 本地开发环境与 Repo Ready（M0-基础）

## 目标

把后续迭代需要的“地基”先跑通：本地可一键启动 Postgres（含 pgvector）/Redis，`apps/api`/`apps/web` 能跑起来并读到环境变量；服务器验收环境（Coolify）具备同等最低依赖。

## 依赖

- 无

## 范围（本 step 做/不做）

- 做：
  - 补齐 `docker-compose`：PostgreSQL（pgvector）+ Redis
  - 提供 `.env.example`（API/Web/DB/Redis）
  - API 提供最小可验收的健康检查（至少能验证 DB/Redis 可连通）
  - 服务器验收环境启动最低依赖：PostgreSQL（pgvector）+ Redis + API + Worker（BullMQ consumer）
- 不做：
  - 业务表结构（Prisma schema/migrations 放到 Step 03）
  - 任何业务 API（Topic/Argument/QV 等）

## 0) Coolify CLI：一次性资源创建（服务器验收机）

> 注意：Token/密码/连接串不要提交到 git；建议写到你自己的密码管理器。

### 0.1 找到 server / project / env

```bash
coolify context verify --context <ctx>
coolify server list --format table

# 新建项目（默认会带 production env）
coolify project create --name epiphany
coolify project list --format table
coolify project get <project_uuid> --format pretty
```

### 0.2 创建 PostgreSQL（pgvector）与 Redis

```bash
coolify database create postgresql \
  --server-uuid <server_uuid> \
  --project-uuid <project_uuid> \
  --environment-name production \
  --name epiphany-postgres \
  --image pgvector/pgvector:pg16 \
  --postgres-user postgres \
  --postgres-password <generated_or_secret> \
  --postgres-db epiphany \
  --instant-deploy

coolify database create redis \
  --server-uuid <server_uuid> \
  --project-uuid <project_uuid> \
  --environment-name production \
  --name epiphany-redis \
  --image redis:7-alpine \
  --redis-password <generated_or_secret> \
  --instant-deploy
```

获取内部连接串（用于注入到 API/Worker 的环境变量）：

```bash
# 会输出敏感信息：不要粘贴/提交到 git
coolify --debug database list --format json --show-sensitive
```

### 0.3 创建 API（NestJS）

```bash
coolify github list --format table

coolify app create github \
  --server-uuid <server_uuid> \
  --project-uuid <project_uuid> \
  --environment-name production \
  --name epiphany-api \
  --github-app-uuid <github_app_uuid> \
  --git-repository hpeXt/EpiphanyV2 \
  --git-branch main \
  --build-pack nixpacks \
  --base-directory /. \
  --ports-exposes 3001 \
  --install-command "npx -y pnpm@10.12.4 install --frozen-lockfile" \
  --build-command "npx -y pnpm@10.12.4 --filter api build" \
  --start-command "NODE_ENV=production node apps/api/dist/main.js"
```

注入环境变量（示例 key；value 用你上一步拿到的 internal db url）：

```bash
coolify app env create <api_app_uuid> --key DATABASE_URL --value "<postgres_internal_db_url>"
coolify app env create <api_app_uuid> --key REDIS_URL --value "<redis_internal_db_url>"
coolify app env create <api_app_uuid> --key PORT --value 3001
```

### 0.4 创建 Worker（BullMQ consumer）

Worker 不一定需要对外域名；若没有 HTTP server，建议关闭 healthcheck，用日志验收即可。

```bash
coolify app create github \
  --server-uuid <server_uuid> \
  --project-uuid <project_uuid> \
  --environment-name production \
  --name epiphany-worker \
  --github-app-uuid <github_app_uuid> \
  --git-repository hpeXt/EpiphanyV2 \
  --git-branch main \
  --build-pack nixpacks \
  --base-directory /. \
  --ports-exposes 3002 \
  --install-command "npx -y pnpm@10.12.4 install --frozen-lockfile" \
  --start-command "npx -y pnpm@10.12.4 --filter worker start" \
  --health-check-enabled=false

coolify app env create <worker_app_uuid> --key REDIS_URL --value "<redis_internal_db_url>"
coolify app env create <worker_app_uuid> --key WORKER_QUEUE_NAME --value "dev-ping"
```

（可选）创建 Web（用于 UI E2E）：

```bash
coolify app create github \
  --server-uuid <server_uuid> \
  --project-uuid <project_uuid> \
  --environment-name production \
  --name epiphany-web \
  --github-app-uuid <github_app_uuid> \
  --git-repository hpeXt/EpiphanyV2 \
  --git-branch main \
  --build-pack nixpacks \
  --base-directory /. \
  --ports-exposes 3000 \
  --install-command "npx -y pnpm@10.12.4 install --frozen-lockfile" \
  --build-command "npx -y pnpm@10.12.4 --filter web build" \
  --start-command "npx -y pnpm@10.12.4 --filter web start"

coolify app env create <web_app_uuid> --key NEXT_PUBLIC_API_URL --value "<api_public_base_url>"
```

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
- [ ] pgvector 已启用（在库里执行一次即可）：`CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] 部署 API：`coolify deploy name <api_app_name>`
- [ ] API 运行正常：`coolify app logs <api_app_uuid> -n 200` 无启动错误
- [ ] 对外冒烟：`curl -fsS "$API_BASE_URL/health"` 返回 `db:"ok"`、`redis:"ok"`
- [ ] 部署 Worker：`coolify deploy name <worker_app_name>`
- [ ] Worker 运行正常：`coolify app logs <worker_app_uuid> -n 200` 无启动错误
- [ ] （若 Worker 暴露健康检查）对外冒烟：`curl -fsS "$WORKER_BASE_URL/health"` 返回 `{"ok":true}`（或等价字段）
- [ ] 故意让 DB 或 Redis 不可用（停服务/改环境变量）时：`curl -fsS "$API_BASE_URL/health"` 必须失败（防止“假绿”）

建议落点：`apps/api/test/health.e2e-spec.ts`（沿用现有 Jest e2e 结构）。

## 2) Green：最小实现（让测试通过）

- `docker-compose.yml` 增加服务：
  - `postgres`：开启 5432，初始化用户/库（用于后续 Prisma），并确保 `pgvector` 可用（推荐 `pgvector/pgvector` 镜像 + initdb 脚本 `CREATE EXTENSION vector;`）
  - `redis`：开启 6379
- 根目录增加 `.env.example`（最少包含）：
  - `DATABASE_URL=postgresql://...`
  - `REDIS_URL=redis://...`
  - `API_PORT=3001`
  - `NEXT_PUBLIC_API_URL=http://localhost:3001`
- `apps/api`：
  - 增加 Health Controller/Route（`/health`）
  - 增加 DB/Redis 连通性探测（例如 `SELECT 1`/协议握手 + Redis `AUTH?` + `PING`）

## 3) Refactor：模块化与收敛

- [ ] 把 DB/Redis 探测封装成可注入 service（避免 controller 里直接写连接逻辑）
- [ ] 约定统一的配置读取方式（`.env` → `process.env`；具体配置模块可后置）

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `curl -fsS "$API_BASE_URL/health"`
    - `coolify deploy name <worker_app_name>`
  - 本地快速反馈（可选）：
    - `cp .env.example .env`
    - `docker compose up -d postgres redis`
    - `pnpm -C apps/api test:e2e`
    - `pnpm dev`
- 验收点
  - [ ] API `/health` 通过（含 DB/Redis 探测）
  - [ ] Web 可启动（页面可暂时空）
