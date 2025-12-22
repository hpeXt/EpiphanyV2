# Step 01 — 本地开发环境与 Repo Ready（M0-基础）

## 目标

把后续迭代需要的“地基”先跑通：本地可一键启动 Postgres（含 pgvector）/Redis，`apps/api`/`apps/web` 能跑起来并读到环境变量；服务器验收环境（Coolify）具备同等最低依赖。

> 重要：本仓库后续所有 step 的“验收/回归/冒烟”默认都围绕 **同一台 Coolify 服务器**进行，本地只作为可选的快速反馈。
> 默认验收机的 context/uuid/URL 见：`docs/stage01/coolify-target.md`（不含任何敏感信息）。

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

### 0.1 使用本仓库默认验收机（推荐）

把 `docs/stage01/coolify-target.md` 的 export 段复制到你的终端，然后执行：

```bash
coolify context verify --context "$COOLIFY_CONTEXT"
coolify resource list --format table

coolify deploy batch epiphany-postgres,epiphany-redis,epiphany-api,epiphany-worker,epiphany-web --force

curl -fsS "$API_BASE_URL/health"
curl -fsS "$WORKER_BASE_URL/health"
```

（可选）验证 Worker 能消费最小 job（Suite A3）：

```bash
curl -fsS -X POST "$WORKER_BASE_URL/enqueue-ping"
coolify app logs "$WORKER_APP_UUID" -n 200
```

### 0.2 找到 server / project / env

```bash
coolify context verify --context <ctx>
coolify server list --format table

# 新建项目（默认会带 production env）
coolify project create --name epiphany
coolify project list --format table
coolify project get <project_uuid> --format pretty
```

### 0.3 创建 PostgreSQL（pgvector）与 Redis

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

#### pgvector 启用/校验（一次性）

在还没有 migrations（Step 03）之前，你需要在库里执行一次：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

推荐流程（执行完立刻关回公网端口）：

```bash
# 1) 临时开放 Postgres 公网端口（示例用 6543）
coolify database update <postgres_uuid> --is-public --public-port 6543

# 2) 用 debug 输出拿到 postgres 密码（或 internal_db_url 里解析）
coolify --debug database list --format json --show-sensitive

# 3) 用 psql 执行（<server_public_ip> 为服务器公网 IP；port 为上一步 public-port）
PGPASSWORD="<postgres_password>" psql -h <server_public_ip> -p 6543 -U postgres -d epiphany \
  -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"

# 4) 关回公网访问
coolify database update <postgres_uuid> --is-public=false
```

### 0.4 创建 API（NestJS）

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

### 0.5 创建 Worker（BullMQ consumer）

本仓库的 Worker 默认内置极简 HTTP server（`GET /health`、`POST /enqueue-ping`）用于验收；若你不想对外暴露，也可以不绑定域名并关闭 healthcheck，仅用日志验收即可。

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

对照全量规划：`docs/stage01/test-plan.md`（Suite A — 基础健康检查）。

### API（e2e / smoke）

- [ ] `GET /health`：返回 `200`，响应体为 JSON，且包含 `db: "ok"`、`redis: "ok"`（或等价字段）
- [ ] Health 响应不得泄露敏感信息（例如 `DATABASE_URL`、密码、内部 IP）
- [ ] 当 Postgres/Redis 不可用时：`/health` 返回非 `200`（或 `db:"fail"/redis:"fail"`，但要在测试里锁死口径）

### 服务器验收（Smoke，黑盒）

通过 Coolify CLI 围绕同一台验收机执行（运行手册：`docs/stage01/coolify-acceptance.md`）。

前置：先按 `docs/stage01/coolify-target.md` export 环境变量（`COOLIFY_CONTEXT/API_BASE_URL/...`）。

- [ ] `coolify context verify --context "$COOLIFY_CONTEXT"`
- [ ] Postgres/Redis 资源处于可用状态（`coolify database get "$POSTGRES_UUID"` / `coolify database get "$REDIS_UUID"`）
- [ ] Postgres 镜像为 `pgvector/pgvector:pg16`（`coolify database get "$POSTGRES_UUID"` 可见；`vector` extension 将在 Step 03 migrations 自动创建）
- [ ] 部署 API：`coolify deploy name "$API_APP_NAME" --force`
- [ ] API 运行正常：`coolify app logs "$API_APP_UUID" -n 200` 无启动错误
- [ ] 对外冒烟：`curl -fsS "$API_BASE_URL/health"` 返回 `db:"ok"`、`redis:"ok"`
- [ ] 部署 Worker：`coolify deploy name "$WORKER_APP_NAME" --force`
- [ ] Worker 运行正常：`coolify app logs "$WORKER_APP_UUID" -n 200` 无启动错误
- [ ] 对外冒烟：`curl -fsS "$WORKER_BASE_URL/health"` 返回 `{"ok":true}`（或等价字段）
- [ ] （可选）Worker 消费验证：`curl -fsS -X POST "$WORKER_BASE_URL/enqueue-ping"` 后查看 `coolify app logs "$WORKER_APP_UUID" -n 200`
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
    - `coolify deploy batch epiphany-postgres,epiphany-redis,epiphany-api,epiphany-worker,epiphany-web --force`
    - `curl -fsS "$API_BASE_URL/health"`
    - `curl -fsS "$WORKER_BASE_URL/health"`
  - 本地快速反馈（可选）：
    - `cp .env.example .env`
    - `docker compose up -d postgres redis`
    - `pnpm -C apps/api test:e2e`
    - `pnpm dev`
- 验收点
  - [ ] API `/health` 通过（含 DB/Redis 探测）
  - [ ] Web 可启动（页面可暂时空）
