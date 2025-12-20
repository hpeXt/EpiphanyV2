# Coolify 目标环境（EpiphanyV2 Staging）

> 本文件固化“本仓库默认围绕哪台 Coolify 服务器做验收”。不包含 token/密码等敏感信息。
>
> 操作手册见：`docs/coolify-acceptance.md`。

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

> 说明：若 API 实际挂载在 `/api`（即对外路径为 `/api/v1/...`），`scripts/coolify/*.mjs` 会自动把 baseUrl 的 mount path 拼到请求 URL 上；签名默认仍按契约的 `/v1/...` 计算。
>
> 如果验签失败，尝试 `--sign-with-mount`（把 `/api` 也纳入 canonical PATH）。

## 资源清单（uuid / name）

应用（Application）：

- Web：`x00s88swo4swcg0kw0wo0gk0` / `epiphany-web`
- API：`q88skk4c04kwwg8wwok0skos` / `epiphany-api`
- Worker：`wc40sgskgwcgocg0400k808k` / `epiphany-worker`（当前：`exited:unhealthy`）

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

export POSTGRES_UUID="vss04sksckos8s88o4wg4g0w"
export REDIS_UUID="kgc80gs8ookw80owgg4o8sgo"
```

