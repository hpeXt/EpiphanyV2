# Coolify 目标环境（EpiphanyV2 Staging）

> 本文件固化“本仓库默认围绕哪台 Coolify 服务器做验收”。不包含 token/密码等敏感信息。
>
> 操作手册见：`docs/stage01/coolify-acceptance.md`。

## Context

- 默认 context：`my-coolify`
- Coolify URL：`https://coolify.4seas.dev`

验证：

```bash
coolify context verify --context my-coolify
coolify resource list --format table
```

## 对外地址

- Web：`https://epiphany.4seas.dev/`
- API Base：`https://epiphany.4seas.dev/api`
- Worker Base（临时）：`http://wc40sgskgwcgocg0400k808k.45.77.19.115.sslip.io`

> 说明：若 API 实际挂载在 `/api`（即对外路径为 `/api/v1/...`），`scripts/coolify/*.mjs` 会自动把 baseUrl 的 mount path 拼到请求 URL 上；签名默认仍按契约的 `/v1/...` 计算。
>
> 如果验签失败，尝试 `--sign-with-mount`（把 `/api` 也纳入 canonical PATH）。

## 资源清单（uuid / name）

应用（Application）：

- Web：`x00s88swo4swcg0kw0wo0gk0` / `epiphany-web`
- API：`q88skk4c04kwwg8wwok0skos` / `epiphany-api`
- Worker：`wc40sgskgwcgocg0400k808k` / `epiphany-worker`（期望：`running:*`；状态以 `coolify resource list` 为准）

数据库/服务：

- Postgres：`vss04sksckos8s88o4wg4g0w` / `epiphany-postgres`
- Redis：`kgc80gs8ookw80owgg4o8sgo` / `epiphany-redis`
- KeyDB：`uwkwk44gs0484gw00ckwcwk0` / `epiphany-keydb`（暂不作为主依赖）
- Dragonfly：`wg8k0gss0kswkkss08gcks0g` / `epiphany-dragonfly`（暂不作为主依赖）

## 建议的本地环境变量（便于复用命令）

```bash
export COOLIFY_CONTEXT="my-coolify"
export WEB_BASE_URL="https://epiphany.4seas.dev"
export API_BASE_URL="https://epiphany.4seas.dev/api"

export WEB_APP_NAME="epiphany-web"
export WEB_APP_UUID="x00s88swo4swcg0kw0wo0gk0"
export API_APP_NAME="epiphany-api"
export API_APP_UUID="q88skk4c04kwwg8wwok0skos"
export WORKER_APP_NAME="epiphany-worker"
export WORKER_APP_UUID="wc40sgskgwcgocg0400k808k"
export WORKER_BASE_URL="http://wc40sgskgwcgocg0400k808k.45.77.19.115.sslip.io"

export POSTGRES_UUID="vss04sksckos8s88o4wg4g0w"
export REDIS_UUID="kgc80gs8ookw80owgg4o8sgo"
```

## 外部服务配置状态

### OpenRouter（AI Provider）

- **状态**：已配置
- **Base URL**：`https://openrouter.ai/api/v1`
- **环境变量**：`OPENROUTER_API_KEY`（已在 `.env` 中配置，勿提交）

已配置模型：

| 用途 | 环境变量 | 模型 ID |
|------|----------|---------|
| Embedding | `EMBEDDING_MODEL` | `qwen/qwen3-embedding-8b` |
| 立场判定 | `STANCE_MODEL` | `google/gemini-2.5-flash-preview` |
| 报告生成 | `REPORT_MODEL` | `deepseek/deepseek-chat-v3-0324` |

验证：

```bash
# 测试 API Key 有效性
curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 200
```

> 注意：部署到 Coolify 时需在应用环境变量中配置 `OPENROUTER_API_KEY`。
