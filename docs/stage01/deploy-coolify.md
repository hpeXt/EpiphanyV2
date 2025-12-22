# Coolify 部署（拆分 Web / API）

本仓库是一个 pnpm workspace 的 monorepo：

- `apps/web`：Next.js（容器端口 `3000`）
- `apps/api`：NestJS（容器端口 `3001`）

目标：在 Coolify 里创建 **两个 Application**，分别部署 `web` 与 `api`（不使用 `docker-compose.yml`）。

---

## 1) 部署 API（NestJS）

在 Coolify 新建一个 Application（或 Resource）：

- **Repository / Branch**：选择你的仓库与分支（建议 `main`）
- **Build Pack**：Dockerfile
- **Dockerfile Path**：`apps/api/Dockerfile`
- **Build Context / Base Directory**：仓库根目录（确保能找到根目录的 `package.json` / `pnpm-lock.yaml`）
- **Port**：`3001`
- **Domain**：例如 `https://api-staging.example.com`

环境变量（API）建议：

- `NODE_ENV=production`
- `API_PORT=3001`（或 `PORT=3001`）
- `CORS_ORIGIN=https://web-staging.example.com`（如果 Web 需要在浏览器里直接请求 API）
- `CORS_CREDENTIALS=true`（可选；仅当你需要 Cookie/凭证跨域时）

验证：

- 访问 `https://api-staging.example.com/` 应返回 `Hello World!`

---

## 2) 部署 Web（Next.js）

在 Coolify 新建第二个 Application：

- **Repository / Branch**：同上（同一个仓库/分支）
- **Build Pack**：Dockerfile
- **Dockerfile Path**：`apps/web/Dockerfile`
- **Build Context / Base Directory**：仓库根目录
- **Port**：`3000`
- **Domain**：例如 `https://web-staging.example.com`

环境变量（Web）建议：

- `NODE_ENV=production`
- `NEXT_PUBLIC_API_URL=https://api-staging.example.com`（当你的前端代码用到它时）

重要说明（Next.js）：

- `NEXT_PUBLIC_*` 通常是 **构建期注入**（build-time）。如果你发现运行期改了变量但页面里还是旧值，请在 Coolify 里把它放到 **Build Variables / Build Args**（或重新触发 build）。
- `apps/web/Dockerfile` 已支持 `ARG NEXT_PUBLIC_API_URL`，方便在构建时传入。

---

## 3) 常见坑

- **Dockerfile 能否找到根目录文件**：两套 Dockerfile 都会 `COPY` 根目录的 `package.json/pnpm-lock.yaml/pnpm-workspace.yaml`；所以构建上下文务必是仓库根目录。
- **跨域（CORS）**：如果 Web（浏览器）直接请求 API 域名，需要设置 `CORS_ORIGIN`；否则会被浏览器拦截。

---

## 4) 你把测试环境给我时，需要发这些

- `web` URL、`api` URL
- 部署的分支/commit
- 若启用访问保护（Basic Auth / 账号密码），提供测试账号
- 出问题时：Coolify 的 build log + runtime log（关键报错几行即可）

