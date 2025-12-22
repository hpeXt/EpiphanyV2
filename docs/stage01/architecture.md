# AI 思想市场（The Thought Market）架构设计

> 参考：`docs/prd.md`（PRD v3.1）与 `docs/design.md`（Persona5 对齐视觉规范）。本仓库使用 **Turborepo + pnpm workspaces** 进行构建与任务编排（见根目录 `package.json` / `turbo.json` / `pnpm-workspace.yaml`）。

API 契约（请求/响应/错误/鉴权/SSE）以 `docs/api-contract.md` 为准。

核心时序图/流程图（端到端）见 `docs/core-flows.md`。

AI 异步任务与可选 Python 计算服务的细化设计见 `docs/ai-worker.md`。

## 1. 架构目标

- **结构化讨论**：Kialo 式父子论点树（Topic/Argument），支持全局/局部两种可视化视图。
- **机制设计**：每个 Topic 独立二次方投票（Quadratic Voting, QV）资金池与质押/撤回。
- **AI 辅助治理**：立场判定、阵营识别、共识报告生成；AI 是“裁判/书记员”而非创作者。
- **高匿名性**：每个 Topic 派生独立身份密钥；后端不建立跨 Topic 的用户关联。

## 2. 系统概览（建议的 MVP 形态）

组件划分（从“先做出来”到“可演进”）：

- **Web（Next.js）**：渲染两种视图、输入编辑器、投票交互；Topic 详情页使用 Top-Down “逻辑蓝图”树形视图（渐进式披露 + 直角连线）；本地保存 Master Seed 与“我的界面”聚合数据。
- **API（NestJS）**：Topic/Argument/QV 等核心读写 API；签名验签与风控；对外提供查询与写入。
- **Worker（BullMQ）**：异步 AI 任务（embedding、立场判定、聚类、报告生成）；与 API 解耦但可同仓实现。
- **PostgreSQL + pgvector**：业务数据与向量存储、索引；事务保证 QV 资金池/质押一致性。
- **Redis**：BullMQ 队列；可选做限流/幂等等轻量状态。
- **（可选）AI Worker（Python/FastAPI）**：当 Node 侧聚类性能不足时，承接 UMAP/HDBSCAN 批处理。
- **外部 AI 提供商**：Embedding/LLM（按 PRD 指定或可替换）。

> 现状提示：`apps/web` 与 `apps/api` 目前仍是脚手架级别代码；文档先把目标架构写清楚，再逐步落地。

## 3. 仓库结构与构建（Turborepo）

> 说明：`packages/*` 当前尚未落地（目录为空）；以下为 v1.0 规划的拆分方式。

- `apps/web`：Next.js 前端应用
- `apps/api`：NestJS 后端应用
- `apps/ai-worker`：Python（FastAPI）AI 计算服务（可选）
- `packages/shared-contracts`：Zod schemas / DTOs / API & SSE 事件定义（可测试的契约）
- `packages/core-logic`：QV 交易计算、余额/质押不变量等纯业务逻辑（无框架依赖，便于 TDD）
- `packages/database`：数据库 schema/migrations（Prisma，v1.0 选定）
- `packages/crypto`：BIP39/HMAC-SHA512/Ed25519 派生、签名与验签（前后端共用）
- `packages/eslint-config`：统一 lint 规则（可选）

建议的常用命令（根目录）：

- 开发：`pnpm dev`（实际执行 `turbo dev`，并行启动各 app 的 dev 任务）
- 构建：`pnpm build`（实际执行 `turbo build`）

## 4. 关键领域模型（建议）

> PRD 已给出 `Topic` / `Argument` / `UserLedger` 的方向；这里补齐为可实现的最小闭环。

- `Topic`
  - `id`（后端生成 UUID v7，用于 URL 与索引友好）
  - `rootArgumentId` / `title`（列表页缓存；以 Root Argument 为准）/ `createdAt`
  - `ownerPubkey`（该 Topic 内的 Host 身份公钥；通过“认领/SetConfig”写入并锁定）
  - `status`：`active | frozen | archived`
- `Argument`
  - `id` / `topicId` / `parentId`
  - Root 约定：每个 Topic 在创建时生成 1 条 Root Argument（`parentId=null`），其内容复制创建时提交的 `title/body`（树结构全程统一）
  - `title`（nullable；Root 必填）/ `body`（原文）/ `authorPubkey`（该 Topic 内派生身份）
  - `analysisStatus`：`pending_analysis | ready | failed`（用于“占位节点”降级渲染）
  - `stanceScore`（-1~+1，相对 parent，用于立场样式编码：反对/中立/支持）
  - `totalVotes`（Int，反范式列）/ `totalCost`（Int，反范式列）
  - `embedding`（pgvector `vector(4096)`）/ `metadata`（JSON：提取摘要、引用等）
  - `prunedAt` / `pruneReason`（软删除/隐藏）
- `Stake`（或 `VoteStake`）
  - `topicId` / `argumentId` / `voterPubkey`
  - `votes`（Int，强制整数制）与 `cost=votes^2`（Int，可冗余存储，便于校验/查询）
- `Ledger`（每 Topic 每身份 100 积分资金池）
  - `topicId` / `pubkey` / `balance`
  - `balance`：Int（MVP 强制整数积分，避免浮点误差）
  - `totalVotesStaked`（Int）/ `totalCostStaked`（Int）/ `lastInteractionAt`（Timestamp）
  - 约束：`balance >= 0`；`sum(cost of all stakes) + balance == 100`
- `Camp`（聚类结果：每 Topic 的语义阵营）
  - `id`（clusterId，Int，HDBSCAN label；噪声点不属于任何 camp）/ `topicId` / `label`（可选）/ `createdAt`
  - `summary`（可选，AI 生成的阵营摘要）
- `ClusterData`（用于 God View 的 2D 投影坐标持久化）
  - `topicId` / `argumentId`（unique）/ `clusterId`（FK → `Camp.id`）
  - `umapX`（Float）/ `umapY`（Float）
  - `computedAt`（Timestamp；v1.0 仅保留 latest 覆盖更新）
- `ConsensusReport`（可后置到 AI 阶段落地）

## 5. 核心流程（端到端）

### 5.1 创建 Topic（关键：派生身份与 Host）

决策：TopicID 由后端生成（UUID v7），创建与“认领（Host 锁定 owner）”两步完成：

1. **Host 创建**：Host 提交标题/根文本 → 后端生成 `topicId` 并返回。
   - 接口：`POST /v1/topics`
   - 同一事务创建 Root Argument：`Argument.parentId=null`，`Topic.rootArgumentId` 指向该 Argument，内容复制创建时提交的 `title/body`；`Topic.title` 作为列表页缓存。
   - 响应字段（v1.0）：`{ topicId, rootArgumentId, claimToken, expiresAt }`（`claimToken` TTL 5~10 分钟）
2. **Host 认领（SetConfig）**：Host 拿到 `topicId` 后，本地用 `masterSeed + topicId` 派生 `hostKeypair`（Ed25519），发送带签名的 `SetConfig` 请求；后端验签并锁定 `Topic.ownerPubkey`。
   - 接口：`POST /v1/topics/:topicId/commands`（`type=CLAIM_OWNER`）
3. **访客流程**：访客打开 URL 获取 `topicId` → 本地派生 `guestKeypair` → 之后所有写请求均带签名（读请求是否签名取决于风控策略）。

决策：为避免“topicId 被提前泄露导致抢占认领”，`claimToken` 由后端生成并存储（Redis，TTL 5~10 分钟），`CLAIM_OWNER` 必须携带 `X-Claim-Token`，成功后立即销毁 token。

#### Host 管理接口（SetConfig 命令模式）

决策：采用单一命令式接口（contracts 统一、便于 TDD）。

- 形式：`POST /v1/topics/:topicId/commands`
- 请求体：`{ type: "...", payload: {...} }`（Zod Discriminated Union）
- 鉴权：使用签名 Headers（见「6. 鉴权与匿名性」）；`CLAIM_OWNER` 额外要求 `X-Claim-Token`
- 典型命令：
  - `CLAIM_OWNER`：锁定 `Topic.ownerPubkey`（必须带 `X-Claim-Token`）
  - `SET_STATUS`：`active | frozen | archived`
  - `EDIT_ROOT`：修改 Root Argument（`title/body`），同时同步更新 `Topic.title`（列表页缓存）
  - `PRUNE_ARGUMENT`：标记节点为 pruned（v1.0：普通用户 tree/children 接口默认不返回，视为“隐藏+子树不可达”；不参与聚类；不自动退款；对该节点 `setVotes` 禁止加票，仅允许减票/撤回；My Activity 必须可见并支持“一键撤回”；可选 `UNPRUNE_ARGUMENT`）

权限白名单（v1.0）：

- `active`：允许所有 Host 命令
- `frozen`：禁止 `EDIT_ROOT` / `PRUNE_ARGUMENT`，仅允许 `SET_STATUS(active)` 解冻
- `archived`：只读（不可逆；不再接受 Host 命令；允许用户撤回既有质押）

Topic 状态对普通写操作的影响（v1.0）：

- `active`：允许 `createArgument` / `setVotes`（增减票）
- `frozen`：Read-Only（禁止新增节点与加票；允许 `setVotes` 减票/撤回）
- `archived`：Read-Only（同 frozen；不可解冻）

### 5.2 发言（Argument 写入 + AI 立场判定）

1. 客户端用派生的 `topicKeypair` 对请求做签名鉴权（签名 headers + canonical payload；见第 6 节）。
2. API 事务写入 `Argument`（先写 raw 文本；支持可选 `initialVotes`）。
   - 接口：`POST /v1/topics/:topicId/arguments`
3. 若携带 `initialVotes`：同一事务内完成扣费与 `Stake` 写入（避免“有观点无票”的中间态）。
   - 余额不足：整个请求失败（HTTP 402），不产生 Argument（避免垃圾节点）。
4. 立场判定/Embedding **异步化**（BullMQ）：写入时标记 `analysisStatus=pending_analysis`，立即返回成功给前端。
5. Worker 完成分析后回填 `stanceScore/embedding/analysisStatus=ready`，并通过 SSE 通知前端更新。

降级渲染（Fallback）：当 `analysisStatus=pending_analysis` 时，前端以“占位节点”样式渲染（例如灰色/虚线边框、无立场色）；待分析完成后播放边框“着色”动画（灰 → RebelRed/Acid/Electric；详见 `docs/design.md`）。立场分只影响样式，不影响树布局位置。

### 5.3 QV 投票/撤回（强一致性）

写路径必须由数据库事务保证：

- 设置某 `argumentId` 的 `votes`：计算新旧 `cost` 差额，在 `Ledger.balance` 与 `Stake` 之间原子更新。
- 撤回不是单独动作，而是 **`setVotes(targetVotes)`**：允许从 `currentVotes -> targetVotes` 平滑调整；当 `targetVotes=0` 等价于完全撤回。
  - 接口：`POST /v1/arguments/:argumentId/votes`

约束与幂等（v1.0）：

- 上限：无需额外硬上限；每 Topic 100 分资金池天然限制 `votes <= 10`（`votes^2 <= 100`）。
- 幂等：使用请求 `nonce` 作为幂等键（Idempotency Key），Redis 缓存 5 分钟；重复 nonce 直接返回上次成功结果。
- Pruned：被 `PRUNE_ARGUMENT` 标记的节点禁止增加票数，仅允许 `setVotes(targetVotes <= currentVotes)` 撤回（不自动退款）。

读路径：

- 决策：Dialogue Stream 的“最热”排序口径是 **`Stake_self = totalVotes`（节点自身总票数）**；Cost 仅用于交易确认弹窗与资金明细（ledger），不参与默认排序。
- 决策：Focus View 的节点尺寸/描边/连线粗细使用 **`VisualWeight` 传递公式**（见第 7 节），其中 `Stake_self` 仍是 `totalVotes`。

精度约束（决策）：MVP 阶段 **Votes 强制整数**（slider step=1），Cost/Balance 也使用整数存储与计算，避免浮点导致资金池不守恒。

性能（v1.0）：Argument 表必须反范式存储 `totalVotes/totalCost`，避免树渲染时反复 `SUM()` 扫描；在 `setVotes` 事务中用 delta 原子更新。

TDD 建议：在 `packages/core-logic` 提供 `calculateTransaction(currentVotes, targetVotes)`，覆盖扣费/退费与边界条件。

### 5.4 阵营识别与共识报告（异步批处理）

- Worker **按阈值节流触发**（避免按时间导致无意义重算、也避免小变动导致聚类抖动）：
  - 聚合 Topic 下 Argument 的 embeddings（过滤 pruned）→ UMAP → HDBSCAN → 写入 `Camp` 结果
  - 持久化 2D 投影坐标：写入 `ClusterData (argumentId → umapX/umapY/clusterId)`，供 God View 直接渲染（前端不跑 UMAP）
  - 生成共识报告（Prompt Chaining）→ 写入 `ConsensusReport`

触发规则（v1.0）：

- Debounce：任意触发条件下，5 分钟内最多跑一次
- 条件：`new_arguments >= 5` 或 `total_votes_change >= 20%`

UI 呈现原则：

- **边框色永远代表立场（stance）**：RebelRed（反对）/ Acid（中立）/ Electric（支持）（详见 `docs/design.md`）。
- **聚类用边界/等高线/分组背景表示**：让用户直观看到“在吵同一件事（聚类），但立场对立（颜色）”。

## 6. 鉴权与匿名性（需要写清楚的细节）

PRD 的目标可以通过“每 Topic 独立公钥身份”实现，但还需要补齐：

> 密钥派生与签名的完整规范见 `docs/crypto.md`；本节仅保留架构层摘要与接口约束。

- **密钥派生规范**（packages/crypto，跨 JS/Python 一致）：
  - `Mnemonic -> MasterSeed`：BIP39 生成 64-byte seed（可选 passphrase；MVP 默认空 passphrase）
  - `TopicKeyMaterial = HMAC-SHA512(key=MasterSeed, data="thought-market-topic-v1:" + topicId)`（UTF-8）
  - `Ed25519Seed = first_32_bytes(TopicKeyMaterial)`
  - `Ed25519Keypair = keyPair.fromSeed(Ed25519Seed)`（JS 可用 `tweetnacl`，Python 可用 `pynacl/libsodium`）
- **签名 Contracts（v1.0）**：不直接签 JSON 对象，签固定字段拼接的 Raw String（避免跨语言 JSON 序列化差异）。
  - 算法：Ed25519（PureEdDSA）
  - 推荐库：
    - Web：`@noble/ed25519` 或 `tweetnacl`
    - Node（API）：Node 19+ `crypto.sign/verify('ed25519')` 或 `tweetnacl`
    - Python（Worker）：`pynacl`
  - Header（v1.0）：
    - `X-Pubkey`：hex（小写，64 chars）
    - `X-Signature`：hex（小写，128 chars）
    - `X-Timestamp`：Unix ms
    - `X-Nonce`：随机串
  - Canonical message（v1.0）：
    - 格式：`version|method|path|timestamp|nonce|bodyHash`
    - `version="v1"`
    - `method`：`req.method.toUpperCase()`
    - `path`：`req.path`（不含域名；建议 signed 请求避免依赖 query）
    - `bodyHash`：若 body 为空则 `""`；否则 `sha256(rawBodyString)`（hex 小写）
    - 示例（伪代码）：
      - `payload = ["v1", METHOD, PATH, TS, NONCE, BODY_HASH].join("|")`
      - `signature = ed25519.sign(payload, privateKey)`
    - 实现要点：后端必须基于 **原始请求体 raw string** 计算 hash（不要 re-stringify 解析后的对象）。
- **防重放/幂等**：
  - `X-Timestamp` 校验：`abs(now - ts) < 60s`（首次请求）
  - `X-Nonce` 去重：Redis 记录已用 nonce（默认 TTL 60s）；对 `setVotes` 等强幂等写操作可缓存 5 分钟并复用上次成功结果
- **限流与反垃圾**：匿名体系下必须有风控手段（按 pubkey/IP/行为），否则 Host 的 pruning 会被 spam 压垮。
- **隐私边界说明**：后端仍可通过 IP/时间相关性做弱关联；需要在产品层面明确“加密不可关联”的真实含义与限制。

通信与实时性（决策）：

- 上行写操作：HTTP POST + 乐观更新（React Query/SWR Optimistic Updates）。
- 下行增量更新：SSE 推送（Entity Invalidation）；事件仅携带 `id + reason`，前端用 React Query/SWR 做 `invalidate` 再按需拉取最新数据。
  - 重绘去抖：3 秒（避免投票/分析回填导致高频树重算）

SSE 事件示例（v1.0，JSON 数据体统一为 `{ event, data }`）：

- `argument_updated`：`{ event: "argument_updated", data: { argumentId, reason } }`（`reason`: `new_vote | analysis_done | edited | pruned`）
- `topic_updated`：`{ event: "topic_updated", data: { topicId, reason } }`（`reason`: `status_changed | owner_claimed | root_edited`）
- `cluster_updated`：`{ event: "cluster_updated", data: { topicId } }`

读接口鉴权策略（v1.0）：

- 公共读（不签名，利于缓存）：`GET /v1/topics/:id/tree`、`GET /v1/arguments/:id/children`、`GET /v1/topics/:id/cluster-map`、`GET /v1/sse/:topicId`
- 私密读（需签名）：`GET /v1/topics/:id/ledger/me`（以及所有会返回“只对当前身份有意义”的数据）
- SSE 特例：v1.0 SSE 通道公开且只推公共 invalidation（不推私密数据）；如需“私有通知”，改为 SSE 推 `id`，前端再发带签名的 HTTP 拉取详情。

SSE 断线续传（v1.0，轻量实现）：

- 事件持久化：Redis Stream `topic:events:{topicId}`，生产者 `XADD` 写入事件；`MAXLEN ~ 1000`
- SSE `id:` 使用 Redis Stream 的 message id（例如 `167888888-0`）
- 前端断线重连：浏览器自动带 `Last-Event-ID`
- 后端检测 `Last-Event-ID`：用 `XRANGE topic:events:{topicId} (<lastId> +` 补发遗漏（`(` 表示不包含起点 id）
- 若 `Last-Event-ID` 过旧（已被 trim）：发送 `reload_required`，前端强制全量刷新

### 6.1 “我的界面”（My Activity）的 N+1 性能风险与批量接口

风险：用户本地保存参与过的 Topic 列表；由于“每 Topic 独立身份”，前端渲染“我的界面”时若对每个 Topic 单独调用 `GET /v1/topics/:id/ledger/me` 会形成 N+1 请求（浏览器并发限制 + 后端瞬时压测）。

架构修改（决策）：提供批量查询接口，将 N 次 RTT 合并为 1 次。

- `POST /v1/user/batch-balance`
- Payload：`{ items: [{ topicId, pubkey, signature, nonce, timestamp }, ...] }`
- 每个 `item.signature`：使用该 `topicId` 派生私钥，按 v1.0 canonical message 对“等价请求”`GET /v1/topics/:topicId/ledger/me`（无 body）进行签名
- 后端：逐项验签后做批量查询（`WHERE (topic_id, pubkey) IN (...)`）并返回结果列表
- 响应字段（v1.0）：`[{ topicId, balance, myTotalVotes, myTotalCost, lastInteractionAt }]`
- 注意：后端不得持久化 `items` 中的 Topic 列表（避免引入“用户-议题”关联）。

为保证 pruned 节点资金可找回（不依赖本地缓存 argumentId），每个 Topic 还需提供“列出我的质押”接口：

- `GET /v1/topics/:id/stakes/me`（需签名）
- 响应字段（v1.0）：`[{ argumentId, votes, cost, argumentPrunedAt, updatedAt }]`（可选附带 `title/excerpt` 便于 UI 识别）

（暂缓）风控增强选项（分层防御）：

- L1：可选 **Hashcash/PoW**（每次发言/投票附带轻量算力证明，提高脚本批量成本）。
- L2：所有写请求必须 **Ed25519 签名**，后端对 `pubkey` 做限流与黑名单。
- L3：对 IP / UA / 行为做速率限制与异常检测（避免单 IP 洪泛）。
- L4：Host pruning 扩展为“Topic 内 pubkey 黑名单”（仅影响当前 Topic，不做跨 Topic 关联）。

## 7. 前端可视化（可行性与建议）

- Focus View（Topic 详情页默认）：Top-Down “逻辑蓝图”树形视图 + 渐进式披露（Progressive Disclosure）
  - 初始加载：`GET /v1/topics/:topicId/tree?depth=3`（depth=层级数，包含 Root；默认 Root+Children+Grandchildren）
  - 懒加载展开：`GET /v1/arguments/:argumentId/children?orderBy=totalVotes_desc`
  - Dialogue Stream（右侧流）：`GET /v1/arguments/:argumentId/children?orderBy=createdAt_desc&beforeId=...`（默认最新），可切换 `orderBy=totalVotes_desc`（最热）；分页使用 cursor（`beforeId`）
  - 连接线：直角折线（Orthogonal），强化逻辑推演的严密感
  - 视觉权重（v1.0）：
    - `Stake_self(n) = totalVotes(n)`（节点自身票数）
    - `VisualWeight(n) = Stake_self(n) + α · Σ VisualWeight(c)`（c 为子节点，α=0.5）
    - `Size = BaseSize + k * log(VisualWeight(n) + 1)`（对数映射，0 票也可点击）
  - 立场映射（v1.0）：`score <= -0.3` `RebelRed`（反对）；`(-0.3, 0.3)` `Acid`（中立）；`score >= 0.3` `Electric`（支持）；`analysisStatus=failed` 虚线灰（未知）（详见 `docs/design.md`）
  - Pruned 节点：普通用户 tree/children 接口默认不返回（视为“隐藏+子树不可达”）；不参与聚类；但 My Activity 必须能列出并一键撤回
- God View（v1.0 决策：散点/语义地图，放弃旭日图）：
  - 目的：鸟瞰“语义阵营/讨论热区”，而非再表达层级结构
  - 渲染：Canvas/WebGL 散点图（UMAP 2D 坐标）
  - 数据来源：读取后端持久化的 `ClusterData(umapX, umapY, clusterId)` + `Camp`（label/summary）
  - 接口（冻结为 contracts）：`GET /v1/topics/:topicId/cluster-map`
    - `modelVersion: string`（例如 `v1-<computedAt>`；用于前端缓存与重绘判断）
    - `points: [{ argumentId, x, y, clusterId, stance, weight }]`
      - `x/y`：归一化到 `[-1, 1]`
      - `clusterId`：HDBSCAN label（Int；噪声/离群点用 `-1`）
      - `stance`：`-1 | 0 | 1`（由 `stanceScore` 阈值映射）
      - `weight`：`log(totalVotes + 1)`（半径编码）
    - `clusters: [{ id, label, summary, centroid: { x, y } }]`
- Next.js 下重可视化建议放在 client component，并避免 SSR 参与 Canvas/WebGL 初始化。

## 8. 暂缓/待决策（v1.0 之外）

- **安全与风控**：PoW/限流粒度/黑名单传播范围与有效期
- **Sybil 抵抗**：每 Topic “每用户 100 积分”的用户定义与成本机制

## 9. 决策清单

1. 已定：**createTopic 认领安全**：响应返回 `claimToken`（TTL 5~10 分钟）；`CLAIM_OWNER` 必须带 `X-Claim-Token`，成功后销毁。
2. 已定：**Topic ID**：后端生成 UUID v7。
3. 已定：**Root Argument 统一**：创建 Topic 时同事务创建 Root Argument（`parentId=null`；Root 含 `title/body`）；`Topic.title` 仅作列表页缓存，以 Root 为准。
4. 已定：**Host 管理接口**：`SetConfig` 命令模式（Zod Discriminated Union）；权限白名单：`active` 全开，`frozen` 仅允许解冻，`archived` 只读不可逆。
5. 已定：**createArgument 原子性**：支持 `initialVotes`；余额不足则整笔失败，不落库 Argument。
6. 已定：**setVotes 上限与幂等**：100 分资金池天然限制 `votes<=10`；`nonce` 作为幂等键（Redis 5 分钟缓存）。
7. 已定：**Focus View 数据读取**：`GET /v1/topics/:topicId/tree?depth=3` 首屏；`GET /v1/arguments/:id/children` 懒加载；children 默认 `totalVotes` 降序。
8. 已定：**Dialogue Stream**：默认 `createdAt` 倒序（最新），可切换“最热（Total Votes）”；cursor 分页（`beforeId`）。
9. 已定：**SSE 推送策略**：Entity Invalidation（只推 `id+reason`）；前端 `invalidate` 拉取；树重绘去抖 3 秒。
10. 已定：**My Activity 性能**：新增 `POST /v1/user/batch-balance`；返回 `balance/myTotalVotes/myTotalCost/lastInteractionAt`。
11. 已定：**ORM**：Prisma。
12. 已定：**QV/树渲染性能**：`Argument.totalVotes/totalCost` 反范式列；`setVotes` 事务内用 delta 原子更新。
13. 已定：**聚类数据持久化**：`Camp` + `ClusterData(umapX, umapY)`，v1.0 仅保留 latest 覆盖更新。
14. 已定：**Pruning 语义**：不参与聚类；不自动退款；对 pruned 节点禁止加票，仅允许减票/撤回（`targetVotes <= currentVotes`）；普通用户 tree/children 默认不返回（隐藏+子树不可达）；My Activity 必须可见并支持“一键撤回”。
15. 已定：**立场阈值**：`[-1,-0.3]` RebelRed、`(-0.3,0.3)` Acid、`[0.3,1]` Electric；`analysisStatus=failed` 虚线灰（详见 `docs/design.md`）。
16. 已定：**聚类节流阈值**：5 分钟 Debounce；`new_arguments>=5` 或 `total_votes_change>=20%` 触发。
17. 已定：**视觉权重口径**：`Stake_self=totalVotes`；`VisualWeight(n)=Stake_self(n)+0.5·ΣVisualWeight(children)`；`Size=BaseSize+k·log(VisualWeight+1)`。
18. 已定：**Embedding 向量维度**：pgvector `vector(4096)`（随模型更换需迁移）。
19. 已定：**签名 Contracts**：Ed25519 + headers（`X-Pubkey/X-Signature/X-Timestamp/X-Nonce`）+ canonical message `v1|METHOD|PATH|TS|NONCE|sha256(rawBody)`。
20. 已定：**读接口鉴权**：公共读不签名（含 SSE）；私密读（如 `GET /v1/topics/:id/ledger/me`）需签名；SSE 只推公共 invalidation。
21. 已定：**SSE Resume**：Redis Stream + `Last-Event-ID` 补发；`MAXLEN ~1000`；过旧发送 `reload_required`。
22. 已定：**God View 形态**：散点/语义地图；冻结 `GET /v1/topics/:topicId/cluster-map`（含 `modelVersion/points/clusters`）。
