# AI 思想市场（The Thought Market）架构设计

> 参考：`docs/prd.md`（PRD v3.0）。本仓库使用 **Turborepo + pnpm workspaces** 进行构建与任务编排（见根目录 `package.json` / `turbo.json` / `pnpm-workspace.yaml`）。

## 1. 架构目标

- **结构化讨论**：Kialo 式父子论点树（Topic/Argument），支持全局/局部两种可视化视图。
- **机制设计**：每个 Topic 独立二次方投票（Quadratic Voting, QV）资金池与质押/撤回。
- **AI 辅助治理**：立场判定、阵营识别、共识报告生成；AI 是“裁判/书记员”而非创作者。
- **高匿名性**：每个 Topic 派生独立身份密钥；后端不建立跨 Topic 的用户关联。

## 2. 系统概览（建议的 MVP 形态）

组件划分（从“先做出来”到“可演进”）：

- **Web（Next.js）**：渲染两种视图、输入编辑器、投票交互；本地保存 Master Seed 与“我的界面”聚合数据。
- **API（NestJS）**：Topic/Argument/QV 等核心读写 API；签名验签与风控；对外提供查询与写入。
- **Worker（BullMQ）**：异步 AI 任务（embedding、立场判定、聚类、报告生成）；与 API 解耦但可同仓实现。
- **PostgreSQL + pgvector**：业务数据与向量存储、索引；事务保证 QV 资金池/质押一致性。
- **Redis**：BullMQ 队列；可选做限流/幂等等轻量状态。
- **（可选）AI Worker（Python/FastAPI）**：当 Node 侧聚类性能不足时，承接 UMAP/HDBSCAN 批处理。
- **外部 AI 提供商**：Embedding/LLM（按 PRD 指定或可替换）。

> 现状提示：`apps/web` 与 `apps/api` 目前仍是脚手架级别代码；文档先把目标架构写清楚，再逐步落地。

## 3. 仓库结构与构建（Turborepo）

- `apps/web`：Next.js 前端应用
- `apps/api`：NestJS 后端应用
- `apps/ai-worker`：Python（FastAPI）AI 计算服务（可选）
- `packages/shared-contracts`：Zod schemas / DTOs / API & SSE 事件定义（可测试的契约）
- `packages/core-logic`：QV 交易计算、余额/质押不变量等纯业务逻辑（无框架依赖，便于 TDD）
- `packages/database`：数据库 schema/migrations（Prisma/Drizzle/TypeORM 三选一，建议统一一个）
- `packages/crypto`：BIP39/HKDF/Ed25519 派生、签名与验签（前后端共用）
- `packages/eslint-config`：统一 lint 规则（可选）

建议的常用命令（根目录）：

- 开发：`pnpm dev`（实际执行 `turbo dev`，并行启动各 app 的 dev 任务）
- 构建：`pnpm build`（实际执行 `turbo build`）

## 4. 关键领域模型（建议）

> PRD 已给出 `Topic` / `Argument` / `UserLedger` 的方向；这里补齐为可实现的最小闭环。

- `Topic`
  - `id`（后端生成 UUID v7，用于 URL 与索引友好）
  - `rootArgumentId` / `title` / `body`（原文）/ `createdAt`
  - `ownerPubkey`（该 Topic 内的 Host 身份公钥；通过“认领/SetConfig”写入并锁定）
  - `status`：`active | frozen | archived`
- `Argument`
  - `id` / `topicId` / `parentId`
  - Root 约定：每个 Topic 在创建时生成 1 条 Root Argument（`parentId=null`），其文本直接复制 `Topic.title/body`（树结构全程统一）
  - `body`（原文）/ `authorPubkey`（该 Topic 内派生身份）
  - `analysisStatus`：`pending_analysis | ready | failed`（用于“胚胎细胞”降级渲染）
  - `stanceScore`（-1~+1，相对 parent，仅用于颜色/角度）
  - `embedding`（pgvector）/ `metadata`（JSON：提取摘要、引用等）
  - `prunedAt` / `pruneReason`（软删除/隐藏）
- `Stake`（或 `VoteStake`）
  - `topicId` / `argumentId` / `voterPubkey`
  - `votes`（整数）与 `cost=votes^2`（可冗余存储，便于校验/查询）
- `Ledger`（每 Topic 每身份 100 积分资金池）
  - `topicId` / `pubkey` / `balance`
  - 约束：`balance >= 0`；`sum(cost of all stakes) + balance == 100`
- `Camp` / `ConsensusReport`（可后置到 AI 阶段落地）

## 5. 核心流程（端到端）

### 5.1 创建 Topic（关键：派生身份与 Host）

决策：TopicID 由后端生成（UUID v7），创建与“认领（Host 锁定 owner）”两步完成：

1. **Host 创建**：Host 提交标题/根文本 → 后端生成 `topicId` 并返回。
   - 同一事务创建 Root Argument：`Argument.parentId=null`，`Topic.rootArgumentId` 指向该 Argument，内容复制 `Topic.title/body`。
2. **Host 认领（SetConfig）**：Host 拿到 `topicId` 后，本地用 `masterSeed + topicId` 派生 `hostKeypair`（Ed25519），发送带签名的 `SetConfig` 请求；后端验签并锁定 `Topic.ownerPubkey`。
3. **访客流程**：访客打开 URL 获取 `topicId` → 本地派生 `guestKeypair` → 之后所有写请求均带签名（读请求是否签名取决于风控策略）。

补充建议：为避免“topicId 被提前泄露导致抢占认领”的极端情况，可在创建 Topic 返回一个短期有效的 `claimToken`，认领时必须携带。

### 5.2 发言（Argument 写入 + AI 立场判定）

1. 客户端用 `topicKeypair` 对请求签名（包含 `topicId/parentId/body/nonce/timestamp`）。
2. API 事务写入 `Argument`（先写 raw 文本）。
3. 立场判定/Embedding **异步化**（BullMQ）：写入时标记 `analysisStatus=pending_analysis`，立即返回成功给前端。
4. Worker 完成分析后回填 `stanceScore/embedding/analysisStatus=ready`，并通过 SSE 通知前端更新。

降级渲染（Fallback）：当 `analysisStatus=pending_analysis` 时，前端渲染为灰色半透明“胚胎细胞”，先位于父节点几何中心；待分析完成后播放“分裂/着色”动画并平滑移动到光谱位置。

### 5.3 QV 投票/撤回（强一致性）

写路径必须由数据库事务保证：

- 设置某 `argumentId` 的 `votes`：计算新旧 `cost` 差额，在 `Ledger.balance` 与 `Stake` 之间原子更新。
- 撤回不是单独动作，而是 **`setVotes(targetVotes)`**：允许从 `currentVotes -> targetVotes` 平滑调整；当 `targetVotes=0` 等价于完全撤回。

读路径：

- 决策：论点流排序/细胞面积按 **`SUM(votes)`（Total Votes）**；同时展示 `SUM(cost)` 作为“总押注积分”（解释投入强度）。

TDD 建议：在 `packages/core-logic` 提供 `calculateTransaction(currentVotes, targetVotes)`，覆盖扣费/退费与边界条件。

### 5.4 阵营识别与共识报告（异步批处理）

- Worker **按阈值节流触发**（避免按时间导致无意义重算、也避免小变动导致聚类抖动）：
  - 聚合 Topic 下 Argument 的 embeddings → UMAP → HDBSCAN → 写入 `Camp` 结果
  - 生成共识报告（Prompt Chaining）→ 写入 `ConsensusReport`

建议触发规则（可配置）：`(new_arguments_count > 5 OR total_staked_change > 10%) AND last_run > 5 mins`。

UI 呈现原则：

- **填充色永远代表立场（stance）**：红↔蓝光谱。
- **聚类用边界/等高线表示**：让用户直观看到“在吵同一件事（聚类），但立场对立（颜色）”。

## 6. 鉴权与匿名性（需要写清楚的细节）

PRD 的目标可以通过“每 Topic 独立公钥身份”实现，但还需要补齐：

- **请求签名格式**：canonical payload、hash、签名算法、字段顺序。
- **防重放**：`timestamp + nonce`，后端需要存储 nonce（Redis/DB）并做过期策略。
- **限流与反垃圾**：匿名体系下必须有风控手段（按 pubkey/IP/行为），否则 Host 的 pruning 会被 spam 压垮。
- **隐私边界说明**：后端仍可通过 IP/时间相关性做弱关联；需要在产品层面明确“加密不可关联”的真实含义与限制。

通信与实时性（决策）：

- 上行写操作：HTTP POST + 乐观更新（React Query/SWR Optimistic Updates）。
- 下行增量更新：SSE 推送；前端对重绘做 `5~10s` 去抖动，产生平滑“呼吸感”。

实现提醒：浏览器原生 `EventSource` 难以携带自定义签名 Header；若 SSE 连接需要鉴权，建议使用 `fetch()` 流式读取（可加 Header），或先通过签名接口换取短期 `sseToken` 再用 query 参数连接。

（暂缓）风控增强选项（分层防御）：

- L1：可选 **Hashcash/PoW**（每次发言/投票附带轻量算力证明，提高脚本批量成本）。
- L2：所有写请求必须 **Ed25519 签名**，后端对 `pubkey` 做限流与黑名单。
- L3：对 IP / UA / 行为做速率限制与异常检测（避免单 IP 洪泛）。
- L4：Host pruning 扩展为“Topic 内 pubkey 黑名单”（仅影响当前 Topic，不做跨 Topic 关联）。

## 7. 前端可视化（可行性与建议）

- Focus View（<20 节点）用 Weighted Voronoi：需要确认使用 **Power Diagram/Laguerre-Voronoi** 的实现库或自研算法；D3 原生 Voronoi 不支持权重。
- God View（>50 节点）用 Canvas/WebGL：建议把布局（树/旭日）与渲染层分离，保证缩放/旋转性能。
- Next.js 下重可视化建议放在 client component，并避免 SSR 参与 Canvas/WebGL 初始化。

## 8. 决策清单

1. 已定：**Topic ID 生成**：后端生成 UUID v7；Host 通过 SetConfig 认领并锁定 `ownerPubkey`。
2. 已定：**QV 权重口径/撤回**：按 Total Votes 排序与渲染；通过 `setVotes(targetVotes)` 支持平滑撤回（Partial Withdrawal）。
3. 已定：**一致性与实时性**：最终一致性 + 乐观 UI + SSE，下行更新做 5~10s 去抖动重绘。
4. 已定：**AI 调用策略**：异步队列 + `pending_analysis` 胚胎状态 + SSE 通知回填结果。
5. 已定：**聚类触发与 UI 呈现**：阈值节流触发；颜色=立场，边界/等高线=聚类。
6. 暂缓：**安全与风控细则**：PoW/限流粒度/黑名单传播范围与有效期（本轮先跳过，不阻塞架构主干）。
7. 暂缓：**Sybil 抵抗**：每 Topic “每用户 100 积分”的“用户”定义与成本机制（本轮先跳过，不阻塞架构主干）。
