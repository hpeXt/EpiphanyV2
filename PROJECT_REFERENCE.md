# EpiphanyV2 — 项目稳定参考（供前端做视觉改造不破坏功能）

本文档目标：提供一份**相对稳定**的“模块/变量/功能命名与边界”说明，让前端在做 UX/UI 视觉重构时，知道**哪些能随意改**、哪些属于**稳定契约（不能随便动）**。

> 约定：若本文与更底层的契约冲突，以 `docs/stage01/api-contract.md` 与 `packages/shared-contracts` 为准。

---

## 1) Single Source of Truth（不要绕开）

- **API 契约（HTTP + SSE）**：`docs/stage01/api-contract.md`
- **数据模型语义与不变量**：`docs/stage01/database.md`
- **签名/派生算法（Ed25519 v1）**：`docs/stage01/crypto.md`（实现：`packages/crypto`）
- **系统架构与决策清单**：`docs/stage01/architecture.md`
- **视觉规范（Persona5 tokens/语法）**：`docs/stage01/design.md`
- **Roadmap 与 Step 过程文档**：`docs/stage01/roadmap.md`、`docs/stage01/steps/*`

---

## 2) 仓库模块地图（Monorepo）

### Apps

- `apps/web`：Next.js Web 前端（页面/组件/签名发请求/SSE 订阅/可视化）
- `apps/api`：NestJS API（契约实现、事务写路径、SSE、限流/黑名单、队列 enqueue）
- `apps/worker`：BullMQ Worker（AI 处理：analysis / clustering / report；目前 AI Provider 默认 mock）

### Packages（稳定边界：尽量别在 UI 重构时改这里的对外接口）

- `packages/shared-contracts`：**前后端共享契约**（Zod schemas + TS types；命名以 `zXxx`/`Xxx` 为主）
- `packages/crypto`：**签名/派生/助记词**（signature v1；历史名 Thought Market signature v1，勿改）
- `packages/core-logic`：QV 纯逻辑（`validateSetVotes`、`INITIAL_BALANCE=100`、投票范围等）
- `packages/database`：Prisma schema + migrations + `getPrisma()`

---

## 3) 运行时系统（服务与端口）

### 本地开发（推荐）

- 根目录：`pnpm dev`（通过 `scripts/dev.mjs` 读取根 `.env`，再跑 `turbo dev`）
- Web：默认 `http://localhost:3000`
- API：默认 `http://localhost:3001`（`.env` 的 `API_PORT`）
- Worker：默认 `http://localhost:3002`（`PORT`/`WORKER_PORT`）

### Docker（可选）

- `docker-compose.yml` 提供 `postgres + redis + api + web`（未包含 worker）

---

## 4) 环境变量（“变量名 → 目的 → 影响范围”）

> 注意：`NEXT_PUBLIC_*` 属于 **构建期注入**（Next.js）；部署时改值不生效通常需要重新 build（见 `docs/stage01/deploy-coolify.md`）。

### 必需/常用

- `DATABASE_URL`：PostgreSQL 连接串（API/Worker/Prisma）
- `REDIS_URL`：Redis 连接串（API：nonce/claimToken/idempotency/SSE stream；Worker：BullMQ）
- `NEXT_PUBLIC_API_URL`：Web 调用 API 的 base URL（例如 `http://localhost:3001`；会自动去掉末尾 `/`）
- `API_PORT` / `PORT`：API 监听端口（默认 3001）
- `WORKER_PORT` / `PORT`：Worker HTTP 监听端口（默认 3002）

### 可选（部署/安全/限流）

- `CORS_ORIGIN`：API CORS origin（逗号分隔；`*`/`true` 表示放开）
- `CORS_CREDENTIALS`：API CORS 是否带 credentials（`true/false`）
- `RISK_*`：API 风控限流参数（429 + `RATE_LIMITED`）
  - `RISK_RL_WINDOW_SECONDS`
  - `RISK_RL_CREATE_ARGUMENT_*` / `RISK_RL_SET_VOTES_*` / `RISK_RL_COMMANDS_*`
  - `RISK_IP_HASH_SALT`

### 可选（Worker clustering / 外部引擎）

- `CLUSTER_ENGINE`：`node|python`（`python` 需要下列变量）
- `AI_WORKER_URL` / `AI_WORKER_TOKEN`：当 `CLUSTER_ENGINE=python` 时使用（`apps/worker/src/clustering/python-topic-cluster-engine.ts`）
- `AI_PROVIDER`：`mock|openrouter`（目前 `openrouter` 仍回退到 mock，见 `apps/worker/src/providers/provider-factory.ts`）

### 说明（目前未实际生效但已预留）

- `.env`/`.env.example` 里包含 `OPENROUTER_*`、`*_MODEL` 等配置项：目前 Worker 的 OpenRouter provider 尚未落地，属于后续扩展位。

---

## 5) 领域对象/命名（前端设计要“认得这些词”）

以下命名在代码/契约/DB 中均稳定出现（建议 UI 文案/信息架构沿用，避免概念漂移）：

- **Topic**：一个讨论主题（每个 topic 独立积分池与身份维度）
- **Argument**：论点节点（树结构：`parentId`；Root 的 `parentId=null`）
- **Ledger（Me）**：某 topic 内当前身份的余额与累计质押（`balance/myTotalVotes/myTotalCost`）
- **Stake（Me）**：某 topic 内对某 argument 的个人质押（`votes/cost`）
- **Prune / pruned**：Host 隐藏节点（公共读不返回；但 stake/withdraw 仍可用）
- **TopicStatus**：`active | frozen | archived`
  - `active`：可发言/可加票
  - `frozen/archived`：只允许撤回（不允许“增加”）
- **SSE Invalidation**：只推“失效通知”，UI 收到后自行 re-fetch（不是推全量数据）
- **God View / Cluster Map**：语义地图（UMAP + HDBSCAN）输出点位与分簇
- **Consensus Report**：共识报告（当前 worker 生成逻辑为 mock，可视作占位实现）

---

## 6) 稳定不变量（UI 改造时不要破坏）

### 6.1 匿名性边界（产品/架构硬约束）

- 后端**不建立跨 Topic 的用户关联**：身份粒度为 `(topicId, pubkey)`。
- UI 侧“我的/My Activity”是**纯客户端聚合**（localStorage 记录 visited topics，再 batch 查询余额）。

### 6.2 QV 与资金守恒（强不变量）

- 每个 topic 初始余额：`100`（见 `packages/core-logic/src/setVotes.ts#INITIAL_BALANCE`）
- 投票范围：`0..10`（整数，step=1）
- QV 成本：`cost = votes^2`（整数）
- 写路径保证（按 topic+pubkey）：`balance + total_cost_staked == 100`
- `setVotes` 的限制语义：
  - `pruned` 或 topic 非 `active`：**禁止增加**，允许减少/撤回
  - 余额不足：HTTP `402` + `INSUFFICIENT_BALANCE`

### 6.3 签名 v1（前端最容易“改 UI 顺手改坏”的部分）

稳定 headers（写请求 + 私密读）：

- `X-Pubkey` / `X-Signature` / `X-Timestamp` / `X-Nonce`

稳定 canonical message（必须完全一致）：

`v1|METHOD|PATH|TIMESTAMP|NONCE|BODY_HASH`

- `PATH` **不含 query string**（前端实现已显式 `path.split("?")[0]`：`apps/web/lib/apiClient.ts`）
- `BODY_HASH` 是 `sha256(rawBodyString)`；后端基于**raw body**算 hash（不要对对象 re-stringify）
- `X-Nonce` 不能包含 `|`
- nonce 去重窗口：60s；`setVotes` 建议对齐到 300s（避免风控/回放窗口不一致），并额外做“强幂等缓存”（5 分钟内同 nonce 重放返回同成功响应）

UI 设计建议：

- 不要在“请求发送前”对 body 做额外格式化（例如 pretty-print JSON）导致 body hash 不一致
- 不要改掉签名逻辑所在文件：`apps/web/lib/signing.ts`（除非同时更新 `docs/stage01/crypto.md` 并回归所有签名相关测试）

### 6.4 SSE（只做 invalidation，不做数据下发）

- 订阅：`GET /v1/sse/:topicId`（EventSource）
- 事件 union 在 `packages/shared-contracts/src/sse.ts`：
  - `argument_updated` / `topic_updated` / `cluster_updated` / `report_updated` / `reload_required`
- Web 当前行为：收到事件后**去抖 3s**触发刷新（`apps/web/components/topics/hooks/useTopicSse.ts`）
- `reload_required(reason="trimmed")`：表示 Redis Stream 事件被裁剪，UI 应提示用户刷新

---

## 7) API 端点与代码对应（方便改 UI 时定位）

> 完整字段/响应以 `docs/stage01/api-contract.md` 与 `@epiphany/shared-contracts` 为准；这里只给“定位地图”。

### Public read（不签名）

- `GET /v1/topics` → `apps/api/src/topic/topic.controller.ts`
- `GET /v1/topics/:topicId/tree` → `apps/api/src/focus-view/topic-tree.controller.ts`
- `GET /v1/arguments/:argumentId/children` → `apps/api/src/focus-view/argument-children.controller.ts`
- `GET /v1/topics/:topicId/cluster-map` → `apps/api/src/topic/topic.controller.ts`
- `GET /v1/topics/:topicId/consensus-report/latest` → `apps/api/src/topic/topic.controller.ts`
- `GET /v1/sse/:topicId` → `apps/api/src/sse/sse.controller.ts`

### Signed（写请求 + 私密读）

- `POST /v1/topics`（创建 topic：**不签名**）→ `apps/api/src/topic/topic.controller.ts`
- `POST /v1/topics/:topicId/arguments` → `apps/api/src/argument/argument.controller.ts`
- `POST /v1/arguments/:argumentId/votes`（强幂等）→ `apps/api/src/votes/votes.controller.ts`
- `POST /v1/topics/:topicId/commands`（Host commands）→ `apps/api/src/topic/topic.controller.ts`
- `GET /v1/topics/:topicId/ledger/me` → `apps/api/src/topic/topic.controller.ts`
- `GET /v1/topics/:topicId/stakes/me` → `apps/api/src/topic/topic.controller.ts`

### Item-level signed（请求本身不签名）

- `POST /v1/user/batch-balance` → `apps/api/src/user/user.controller.ts`
  - 前端构造 item 签名：`apps/web/lib/apiClient.ts#buildBatchBalanceItems`

---

## 8) Web 前端：页面/组件/本地存储（UI 重构主要作用域）

### 路由（Next App Router）

- `/` → redirect 到 `/topics`（`apps/web/app/page.tsx`）
- `/topics`：Topic 列表（`apps/web/app/topics/page.tsx` + `TopicList`）
- `/topics/new`：创建 Topic（`apps/web/app/topics/new/page.tsx` + `CreateTopicForm`）
- `/topics/:topicId`：Topic 详情（`apps/web/app/topics/[topicId]/page.tsx` + `TopicPage`）
- `/my`：My Activity（`apps/web/app/my/page.tsx` + `MyActivity`）

### 关键组件（功能边界）

- `TopicList`：拉取 topics 列表
- `CreateTopicForm`：创建 topic（不签名）
- `TopicPage`：详情页“总编排”（tree/children/SSE/identity/ledger/view mode/管理/报告）
- `FocusView`：Focus 视图（当前为简化树列表）
- `DialogueStream`：右侧对话流（children 列表 + Reply + Vote slider）
- `GodView`：语义地图 Canvas
- `SunburstView`：旭日图（overview）
- `TopicManagePanel`：Owner 管理（freeze/archive/edit root/prune/unprune）
- `ConsensusReportModal`：共识报告弹窗（owner 可触发生成）
- `IdentityOnboarding`：生成/导入助记词并落地本地 master seed

### 本地存储（稳定 key：不要随便改）

- Master seed：`tm:master-seed:v1`（`apps/web/lib/signing.ts`）
- Visited topics：`tm:visited-topics:v1`（`apps/web/lib/visitedTopicsStore.ts`）
- Topic claim tokens：`tm:claim-tokens:v1`（`apps/web/lib/claimTokenStore.ts`；用于创建 topic 后 5 分钟内 `CLAIM_OWNER`）

> 若需要变更 storage 结构：请当作“破坏性变更”，必须提供迁移/兼容逻辑并更新本文档。

### UI 重构“安全区”

通常可以随意改（不影响功能契约）：

- 组件视觉：Tailwind class、布局结构、字体/颜色/间距、动效
- 新增组件库封装（例如 `apps/web/components/ui/*`）
- 将页面拆分/组合（只要保留相同行为与可访问性语义）

需要谨慎（容易破坏功能/契约）：

- `apps/web/lib/apiClient.ts`（契约 parse + signed request 规则）
- `apps/web/lib/signing.ts` / `apps/web/lib/identity.ts`（签名与身份派生）
- `packages/shared-contracts`（对外契约；一改前后端都要跟）

建议保留的可访问性/测试锚点（避免“好看但不可用”）：

- `role="alert"` 的错误态仍要存在
- `Reply` textarea 的 label/aria-label
- Vote slider 的 `aria-label="Votes"`（测试用到了 role slider + name）

---

## 9) Worker：队列/触发链路（改 UI 时常见疑问：为什么会刷新/为什么变色）

### 队列名（稳定）

> 由于 BullMQ 对 jobId 有限制，实际实现用下划线/短横线组合（见注释）。

- `ai_argument-analysis`：论点分析（stance + embedding）
- `ai_topic-cluster`：topic 聚类（cluster map）
- `ai_consensus-report`：共识报告生成

### 触发点（简化链路）

- Web 发言 → API `createArgument` → API enqueue `ai_argument-analysis`
- Worker analysis 完成 →（best-effort）enqueue `ai_topic-cluster`（debounce）
- Web 投票 → API `setVotes` →（best-effort）enqueue `ai_topic-cluster`（debounce）
- Host 生成报告 → API 创建 report 记录并 enqueue `ai_consensus-report`

### SSE 刷新来源

- API 在关键写路径上 best-effort 写入 Redis Stream：`topic:events:{topicId}`
- Web 收到 invalidation 后做 re-fetch（tree/children/cluster-map/report 等）

---

## 10) 给“纯视觉改造”的落地建议（不破坏功能）

1. 先只做“皮肤层”：基于 `docs/stage01/design.md` 的 tokens 在 `apps/web/app/globals.css`/组件 class 上落地（不动请求与状态机）
2. 抽 UI primitives：Button/Card/Panel/Tag/Modal/Toast（集中处理描边/投影/字体/动效）
3. 保留交互语义：不要为了改样式删掉 disabled/aria-* / error alert
4. 每次改动后跑 Web 测试：`pnpm -C apps/web test`
