# Coolify CLI 服务器验收运行手册

> 目标：所有“验收/回归/冒烟”都围绕 **同一个 Coolify 服务器环境**执行；通过 `coolify` CLI 查看资源状态/部署日志/运行日志，并用 HTTP 交互（`curl` 或脚本）验证对外行为是否符合契约。

## 0. 前置条件

- 本机已安装 `coolify` CLI（本仓库默认假设可用：`coolify --help`）
- 你有一个可用的 Coolify 环境（staging/验收机）并已创建本项目的资源（API/Web/Worker/DB/Redis 等）
- 你有 Coolify API Token（不要写进仓库；用 context 或环境变量传入）

## 1. 配置 Coolify Context（一次性）

```bash
# 新增并设为默认（示例）
coolify context add epiphany-staging https://<coolify-host> <token> --default

# 验证连接与鉴权
coolify context verify --context epiphany-staging
```

常用：

```bash
coolify context list
coolify context use epiphany-staging
```

## 2. 资源定位：找到 name 与 uuid

> CLI 的很多命令需要 `<uuid>`；部署可以用 `<resource_name>`。

```bash
# 列出全部资源（应用/服务/数据库）
coolify resource list --format table

# 或分别列出
coolify app list --format table
coolify database list --format table
coolify service list --format table
```

记录这些信息（建议写到你自己的私有笔记/密码管理器，不要提交到 git）：

- API 应用：`<api_app_name>` / `<api_app_uuid>` / 对外 URL（`API_BASE_URL`）
- Web 应用：`<web_app_name>` / `<web_app_uuid>` / 对外 URL（`WEB_BASE_URL`）
- Worker 应用（如有）：`<worker_app_name>` / `<worker_app_uuid>`
- Postgres：`<postgres_uuid>`
- Redis：`<redis_uuid>`

## 3. 通用验收动作（所有 step 通用）

### 3.1 部署

```bash
coolify deploy name <resource_name>
```

部署后可查：

```bash
coolify deploy list --format table | head
coolify app deployments list <app_uuid> --format table
coolify app deployments logs <app_uuid> --format pretty
```

### 3.2 检查运行状态

```bash
coolify app get <app_uuid> --format pretty
coolify database get <db_uuid> --format pretty
coolify service get <service_uuid> --format pretty
```

### 3.3 查看日志（定位失败原因）

```bash
coolify app logs <app_uuid> -n 200
coolify app deployments logs <app_uuid> --format pretty
```

必要时可重启：

```bash
coolify app restart <app_uuid>
coolify database restart <db_uuid>
coolify service restart <service_uuid>
```

## 4. HTTP 交互验收（契约黑盒）

> 对外行为以 `docs/api-contract.md` 为准。建议把 `API_BASE_URL` 设为环境变量。

### 4.1 Health / Smoke

```bash
curl -fsS "$API_BASE_URL/health"
```

### 4.2 签名接口：推荐用脚本生成签名

很多写接口/私密读需要签名 headers（`X-Pubkey/X-Signature/X-Timestamp/X-Nonce`），手工很容易出错。

建议使用本仓库脚本：`scripts/coolify/signed-request.mjs`（不会读你的助记词/私钥；默认生成并缓存一个临时 Ed25519 keypair 到 `tmp/`）。

示例：

```bash
export API_BASE_URL="https://api.example.com"

# 发送一个需要签名的 POST（path 必须是不含 query 的 /v1/...）
node scripts/coolify/signed-request.mjs \
  POST /v1/topics/<topicId>/commands \
  '{"type":"CLAIM_OWNER","payload":{}}' \
  --extra-header "X-Claim-Token: <claimToken>"
```

`POST /v1/user/batch-balance` 属于 **item 级签名**（签名放在 body 里），推荐用：

```bash
node scripts/coolify/batch-balance.mjs <topicId1> <topicId2>
```

## 5. SSE 验收（只推 invalidation）

```bash
curl -N -H "Accept: text/event-stream" "$API_BASE_URL/v1/sse/<topicId>"
```

断线续传：保留最后一次收到的 `id:`，重连时带 `Last-Event-ID`（浏览器会自动带；CLI 需要手动）。

## 6. 与 Steps 的关系

- 每个 `docs/steps/stepXX.md` 的测试部分都应包含：
  - 对应 step 的“服务器验收动作”（部署/状态/日志/HTTP 交互）
  - 与 `docs/test-plan.md` 对应的 Suite/Flow（Flow 1~6）
