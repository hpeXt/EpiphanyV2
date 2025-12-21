# Roadmap（v1.x）

本 Roadmap 基于以下文档整理并“按依赖拆解为可交付的里程碑”：
`docs/prd.md`、`docs/architecture.md`、`docs/api-contract.md`、`docs/database.md`、`docs/crypto.md`、`docs/ai-worker.md`、`docs/core-flows.md`、`docs/design.md`。

> 目标：以 **可验收** 的阶段性交付推进到 v1.0（MVP），并明确 v1.1+ 的后置项。

---

## 0. 范围与硬约束（必须一直成立）

### 0.1 产品边界（来自 PRD）

- 结构化辩论：Kialo 式父子论点树（Topic/Argument），并有 Focus View（默认）与 God View（语义地图）。
- 经济系统：每 Topic 独立 100 积分池；QV `cost=votes^2`；随时可撤回；默认排序按 `totalVotes`（非子树聚合）。
- AI 是裁判/书记员：立场判定（相对 parent）+ 阵营聚类（仅 embedding）+（后置）共识报告。
- 极高匿名性：后端 **不建立跨 Topic 的用户关联**；身份以 `(topicId, pubkey)` 为最小粒度；“我的”页面为纯客户端聚合。
- Host 权限：编辑 Root、冻结/归档、Pruning（隐藏节点）；pruned 不自动退款但允许撤回，且禁止加票仅允许减票/撤回。

### 0.2 技术与契约硬约束（来自 Architecture / Contract / Crypto / DB）

- API 契约冻结：以 `docs/api-contract.md` 为 Single Source of Truth（含错误码、鉴权、SSE、字段口径）。
- 签名 v1：Ed25519 + headers（`X-Pubkey/X-Signature/X-Timestamp/X-Nonce`）+ canonical message `v1|METHOD|PATH|TS|NONCE|sha256(rawBody)`（见 `docs/crypto.md`）。
- 防重放/幂等：
  - `abs(now - X-Timestamp) < 60s`
  - nonce 去重（TTL 60s）
  - `setVotes` 强幂等（Redis 缓存 5 分钟复用成功响应）
- 一致性：账本为唯一真源；QV 交易必须单 DB 事务保证 `balance + total_cost_staked = 100`（整数，不用浮点）。
- SSE：只推 **Entity Invalidation**（`id + reason`），事件用 Redis Stream 持久化并支持 `Last-Event-ID` 续传（过旧则 `reload_required`）。
- Pruning 口径：
  - 公共读（tree/children）默认不返回 pruned
  - 私密读（`/stakes/me`）必须可见并支持找回资金
  - pruned 节点渲染视为 `Stake_self=0` 且从 `VisualWeight` 聚合剔除（避免幽灵权重）

---

## 1. 里程碑（v1.0 MVP）

> 说明：每个里程碑都以“可在本地跑通 + 可用接口验收 + UI 可演示”为准；里程碑间按依赖排序。

### M0 — 开发基建与契约落地（Repo Ready）

**目标**：让后续功能迭代能稳定交付（依赖可控、契约可测试、环境可一键启动）。

**交付物**
- Monorepo 拆包骨架（与 `docs/architecture.md` 对齐）：`packages/shared-contracts`、`packages/core-logic`、`packages/database`、`packages/crypto`。
- `shared-contracts`：用 Zod/TypeScript 固化请求/响应/错误/SSE envelope（与 `docs/api-contract.md` 一致），并提供可复用的 DTO。
- 本地环境：PostgreSQL + Redis 的 `docker-compose`（已有则补齐变量/说明），并提供 `.env.example`。

**验收标准**
- 能在本地启动 API/Web（可暂时空页面），并能连接 Postgres/Redis。
- `shared-contracts` 可在 `apps/api` 与 `apps/web` 同时引用编译通过。

---

### M1 — 数据库与核心不变量（DB + QV Logic）

**目标**：先把资金池/QV 不变量与数据模型落稳，避免后续返工。

**交付物**
- Prisma schema + migrations（对齐 `docs/database.md`）：`topics/arguments/ledgers/stakes/camps/cluster_data/consensus_reports`（报告表可先留空实现，但 schema 需预留）。
- `core-logic`：实现并单测 `setVotes` 交易计算与不变量校验（deltaVotes/deltaCost、余额不足、0..10 约束等）。

**验收标准**
- 迁移可在空库执行成功。
- 单测覆盖：`balance + total_cost_staked = 100` 恒成立；撤回与加票边界正确；pruned/只读限制在逻辑层可表达（由 API 组合）。

---

### M2 — API v1.0（无 AI 的闭环写路径 + SSE）

**目标**：按契约跑通“创建 Topic → 发言 → 投票/撤回 → 实时失效通知”的最小闭环。

**交付物（对齐 `docs/api-contract.md`）**
- Topic
  - `POST /v1/topics`（创建 Topic + Root + claimToken）
  - `POST /v1/topics/:topicId/commands`：`CLAIM_OWNER/SET_STATUS/EDIT_ROOT/PRUNE_ARGUMENT/UNPRUNE_ARGUMENT`
  - `GET /v1/topics`（列表 cursor 分页）
- Focus View 数据
  - `GET /v1/topics/:topicId/tree?depth=3`
  - `GET /v1/arguments/:argumentId/children`（`orderBy=totalVotes_desc|createdAt_desc` + cursor）
- 写路径（签名 + 事务 + 幂等）
  - `POST /v1/topics/:topicId/arguments`（可选 `initialVotes`，余额不足整笔失败）
  - `POST /v1/arguments/:argumentId/votes`（`setVotes` 幂等）
- 私密读（My Activity 支撑）
  - `GET /v1/topics/:topicId/ledger/me`
  - `GET /v1/topics/:topicId/stakes/me`
  - `POST /v1/user/batch-balance`（item 级签名）
- SSE
  - `GET /v1/sse/:topicId`：Redis Stream 续传 + `reload_required`
  - 事件生产：topic/argument/vote/prune/status 变更统一 `XADD topic:events:{topicId}`

**验收标准**
- 端到端时序可对应 `docs/core-flows.md` 的 1~5（不含 AI/聚类）。
- pruned 节点公共读不可见；`stakes/me` 可见并可对其 `setVotes(0)` 找回资金。
- `setVotes` 同 nonce 重放返回同响应（强幂等）。

---

### M3 — Web v1（Focus View + Dialogue Stream + QV）

**目标**：先做“可用”，再做“好看”；Focus View 先落地结构与交互，再逐步 Persona5 化。

**交付物**
- Topic 列表页：展示 `GET /v1/topics`，支持创建入口。
- Topic 详情页：
  - 首屏拉 `GET /v1/topics/:topicId/tree?depth=3`
  - Focus View：Top-Down 渐进式披露 + 直角连线（可先用简化布局，后续替换为 D3 方案）
  - Hover：Calling Card 信息卡（对齐 `docs/design.md`）
  - Click：右侧 Dialogue Stream（拉 `children`，支持“最新/最热”切换与分页）
- 发言：TipTap 输入 + `POST /v1/topics/:topicId/arguments`
- 投票：slider step=1（0..10）+ QV 成本提示 + `POST /v1/arguments/:argumentId/votes`
- SSE 订阅：收到 invalidation 后做 query invalidate + 去抖重绘（3s）

**验收标准**
- 单 Topic 内的新增节点/投票可在两窗口间通过 SSE 秒级同步（无手动刷新）。
- QV 余额/成本显示与后端回执一致（以 Ledger 为真源）。

---

### M4 — 身份系统与“我的”（匿名性闭环）

**目标**：把“后端零知晓 + 用户可恢复 + 可找回质押”的匿名资产闭环做完整。

**交付物**
- `packages/crypto`：按 `docs/crypto.md` 落地（含测试向量互验）。
- Web：助记词生成/备份/恢复 UX（对齐 `docs/prd.md` 2.5）
  - 本地保存 Master Seed（IndexedDB/LocalStorage；可后置加密，但严禁上报/日志记录）
  - 进入 Topic 时派生 topicKeypair 并对写请求签名
- “我的/My Activity”：
  - 本地记录访问过的 topicId 列表
  - 批量余额：`POST /v1/user/batch-balance`
  - 单 Topic 资产：`GET /v1/topics/:topicId/stakes/me` + 一键撤回（对每个 stake 调用 `setVotes(0)`）

**验收标准**
- 清空本地后可通过助记词恢复同一身份与余额。
- pruned 节点上的质押可在“我的”中可见并可撤回。

---

### M5 — Worker：Argument 分析（立场 + Embedding）

**目标**：完成“写入先落地、AI 异步回填”的最小 AI 闭环，并驱动 UI 立场着色。

**交付物（对齐 `docs/ai-worker.md`）**
- BullMQ：`ai:argument-analysis`（`jobId="arg_"+argumentId`）+ 重试/退避。
- Worker 执行：
  - stance（相对 parent，[-1,1]）
  - embedding（4096 维，写入 pgvector）
  - 写回 `analysis_status=ready|failed` + metadata
  - `XADD` → `argument_updated(reason="analysis_done")`
- Web 渲染降级：
  - `pending_analysis`：占位样式（灰/虚线）
  - `ready`：按阈值映射 RebelRed/Acid/Electric（见 `docs/architecture.md` / `docs/design.md`）

**验收标准**
- 新发言在 1~数十秒内由 pending 变为 ready/failed，并触发 UI 更新。
- stance 只影响样式，不影响聚类输入（聚类只用 embedding）。

---

### M6 — God View：聚类批处理（UMAP + HDBSCAN）+ 可视化

**目标**：实现 PRD v1.0 的“语义地图（讨论热区）”，并把聚类计算从前端移到 Worker。

**交付物**
- BullMQ：`ai:topic-cluster`（`jobId="cluster_"+topicId`，delay=5min debounce）
- 阈值与口径：`new_arguments>=5` 或 `total_votes_change>=20%`（过滤 pruned，见 `docs/ai-worker.md`）
- 计算引擎：
  - Node 侧实现或接入可选 Python AI Worker（`CLUSTER_ENGINE=node|python`）
  - 归一化到 `[-1,1]` 并固化 normalization 口径（写入 `camps.params`）
- 落库：覆盖 latest 写入 `camps/cluster_data` + 更新 `topics.last_cluster_*`
- API：`GET /v1/topics/:topicId/cluster-map`
- Web：God View（Canvas/WebGL）散点图
  - 点：`weight=log(totalVotes+1)` 半径编码；颜色=stance bucket；cluster 用背景/等高线/分区表达

**验收标准**
- 数据规模上来（>50 节点）时，能展示语义热区，且 stance 与 cluster 的视觉编码不冲突。
- pruning 后聚类结果更新且 pruned 点不再参与/显示。

---

### M7 — Host 工具与只读语义打磨（治理可用）

**目标**：让 Topic 的“园丁权限”可用，并把冻结/归档/pruning 的全链路语义落到 UI。

**交付物**
- Web：Host 识别（当前 topicKeypair.pubkey == topic.ownerPubkey）并展示管理入口。
- 管理面板：
  - `EDIT_ROOT`（同步更新标题缓存）
  - `SET_STATUS`（active/frozen/archived）
  - `PRUNE_ARGUMENT/UNPRUNE_ARGUMENT`（可选 UNPRUNE）
- UI 限制：
  - frozen/archived：禁止新增节点/加票；允许撤回
  - pruned：公共读不可见；若 UI 通过其它路径拿到其 id，则禁止加票

**验收标准**
- 与 `docs/prd.md` 2.6 与 `docs/architecture.md` 决策清单一致：权限白名单、只读与资金找回成立。

---

## 2. v1.1+ 后置项（明确不在 v1.0 MVP）

### v1.1 — 共识报告（Habermas Machine / Prompt Chaining）

- Worker：`ai:consensus-report` + `consensus_reports` 落库语义与幂等（见 `docs/ai-worker.md` 7）
- 触发：自动（动态重心收敛）或 Host 手动
- UI：全屏模态框展示（Persona5 外框 + 正文排版）

### v1.2 — 风控增强 / Sybil 抵抗

- Hashcash/PoW（L1）、pubkey/IP 限流（L2/L3）、Topic 内黑名单（L4）（见 `docs/architecture.md` 6.1）
- 更明确的“匿名性边界”产品说明（IP/时间相关性无法彻底消除）

### vNext — 可视化扩展

- 旭日图等宏观树结构总览（PRD 标注后置）
- 更丰富的材质/动效库与组件体系沉淀（对齐 `docs/design.md`）
