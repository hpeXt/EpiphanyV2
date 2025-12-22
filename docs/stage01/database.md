# 数据库设计文档（PostgreSQL + pgvector，v1.0）

本文档基于 `docs/prd.md`（v3.1）与 `docs/architecture.md`（v1.0 决策清单）整理，目标是为 MVP 提供**可实现且可演进**的数据库模型与一致性约束。

API 接口与契约以 `docs/api-contract.md` 为准。

## 0. 设计原则（与匿名性边界）

1. **后端不建立跨 Topic 的用户关联**：不设计全局 `users` 表；所有“身份”均以 `pubkey`（Ed25519 公钥）在 **Topic 维度**出现。
2. **账本强一致性**：QV 资金池与质押必须由 **单 DB 事务**保证；避免浮点，统一用整数。
3. **写入先落地，AI 后补齐**：Argument 文本先写入，`stanceScore/embedding` 异步回填。
4. **软删除（Pruning）可追溯**：pruned 节点数据库保留；读取侧按规则折叠/过滤；AI 聚类需过滤 pruned。
5. **面向读性能的反范式**：`Argument.totalVotes/totalCost` 反范式存储，避免渲染树时频繁聚合。

## 1. 技术选型与扩展

- 数据库：PostgreSQL
- 向量：pgvector（`CREATE EXTENSION vector;`）
- 推荐扩展（可选）：`pgcrypto`（生成 UUID/随机值）、`btree_gist`（如后续需要更复杂约束）
- ORM：Prisma（架构文档已定）

> 说明：Topic ID 决策为 **UUID v7**（由后端生成），因此数据库不需要生成 v7 的函数；其它主键也建议统一用 UUID v7，便于 cursor 分页与索引友好。

## 2. 概念模型（ER）

- `Topic` 1—N `Argument`
- `Topic` 1—N `Ledger`
- `Argument` 1—N `Stake`
- `Topic` 1—N `Camp`
- `Argument` 0/1—1 `ClusterData`（每个 Argument 在“最新一次聚类结果”下最多一条坐标记录）
- `Topic` 1—N `ConsensusReport`（可只保留 latest，也可保留历史）

## 3. 表结构（v1.0）

以下为推荐的物理表（snake_case）。字段类型以 PostgreSQL 为准。

### 3.1 `topics`

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK | UUID v7（后端生成） |
| `root_argument_id` | `uuid` | FK → `arguments.id`（延迟/可空写入） | Root Argument 指针（创建 Topic 同事务写入） |
| `title` | `text` | index 可选 | 列表页缓存；以 Root Argument 为准；Root 编辑时同步更新 |
| `owner_pubkey` | `bytea` | 32 bytes；可加索引 | Host 身份公钥（Topic 内派生）；认领后锁定 |
| `status` | `topic_status` | index | `active / frozen / archived` |
| `created_at` | `timestamptz` | index | 创建时间 |
| `updated_at` | `timestamptz` |  | 更新时间 |
| `last_clustered_at` | `timestamptz` |  | 聚类节流（5 分钟 debounce） |
| `last_cluster_argument_count` | `int` |  | 上次聚类时 Argument 数（过滤 pruned） |
| `last_cluster_total_votes` | `int` |  | 上次聚类时总 votes（过滤 pruned） |

推荐约束/默认值：

- `status` 默认 `active`
- `last_cluster_*` 默认 `0/NULL`（由 worker 首次写入）

### 3.2 `arguments`

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK | 建议 UUID v7（后端生成） |
| `topic_id` | `uuid` | FK → `topics.id`；index | 所属 Topic |
| `parent_id` | `uuid` | nullable；index | 父节点；Root 为 NULL |
| `title` | `text` | nullable | Root 必填；非 Root 可空 |
| `body` | `text` |  | 原文 |
| `author_pubkey` | `bytea` | index | Topic 内派生身份 |
| `analysis_status` | `argument_analysis_status` | index | `pending_analysis / ready / failed` |
| `stance_score` | `double precision` | check `[-1,1]` | 相对 parent 的立场分（ready 才可信） |
| `embedding` | `vector(4096)` | vector index 可选 | 语义向量（ready 后写入） |
| `embedding_model` | `text` |  | 例如 `qwen/qwen3-embedding-8b` |
| `metadata` | `jsonb` |  | 摘要/引用/抽取信息等 |
| `total_votes` | `int` | index（排序） | 反范式：该 Argument 自身 votes 之和（不含子树） |
| `total_cost` | `int` |  | 反范式：该 Argument 自身 cost 之和（不含子树） |
| `pruned_at` | `timestamptz` | index（可做 partial） | Host 隐藏时间（软删除） |
| `prune_reason` | `text` | nullable | 可选原因（spam/off-topic 等） |
| `pruned_by_pubkey` | `bytea` | nullable | 可选：执行 pruning 的 Host pubkey（仅 Topic 内） |
| `created_at` | `timestamptz` | index | 创建时间 |
| `updated_at` | `timestamptz` |  | 更新时间 |

关键关系/约束建议：

1. **同 Topic 父子约束**：建议建立复合外键，保证 `parent_id` 指向同一 `topic_id` 下的 Argument。做法：
   - `UNIQUE (topic_id, id)`；然后 `FOREIGN KEY (topic_id, parent_id) REFERENCES arguments(topic_id, id)`
2. **每 Topic 仅一个 Root**：`UNIQUE (topic_id) WHERE parent_id IS NULL`（partial unique index）
3. `total_votes >= 0`、`total_cost >= 0`
4. `analysis_status != ready` 时，允许 `stance_score/embedding` 为 NULL

> Embedding 维度固定为 **4096**（pgvector 需要固定维度）；若后续更换 embedding 模型导致维度变化，建议通过新列或分表迁移处理。Prisma 可用 `embedding Unsupported("vector(4096)")?` 表达该列类型。

### 3.3 `ledgers`（每 Topic 每身份 100 分资金池）

复合主键：`(topic_id, pubkey)`

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `topic_id` | `uuid` | FK → `topics.id` | 所属 Topic |
| `pubkey` | `bytea` | 32 bytes | Topic 内派生身份 |
| `balance` | `int` | check `>=0` | 可用积分（整数） |
| `total_votes_staked` | `int` | check `>=0` | 该身份在 Topic 下总 votes（所有 Argument 的 votes 之和） |
| `total_cost_staked` | `int` | check `>=0` | 该身份在 Topic 下总 cost（所有 Stake 的 cost 之和） |
| `last_interaction_at` | `timestamptz` | index 可选 | 用于“我的界面”与活跃度 |
| `created_at` | `timestamptz` |  | 首次创建账本时间 |
| `updated_at` | `timestamptz` |  | 更新时间 |

推荐不变量（由事务维持）：

- `balance + total_cost_staked = 100`
- `balance ∈ [0, 100]`，`total_cost_staked ∈ [0, 100]`

### 3.4 `stakes`（对单个 Argument 的当前质押）

复合主键：`(topic_id, argument_id, voter_pubkey)`

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `topic_id` | `uuid` | FK → `topics.id` | 冗余存储，便于复合外键约束与索引 |
| `argument_id` | `uuid` | FK → `arguments.id` | 被投票的节点 |
| `voter_pubkey` | `bytea` | 32 bytes；index | 投票者（Topic 内身份） |
| `votes` | `int` | check `>0` | 当前票数（整数） |
| `cost` | `int` | check `= votes*votes` | 当前成本（整数） |
| `created_at` | `timestamptz` |  | 首次下注时间 |
| `updated_at` | `timestamptz` |  | 更新时间 |

关键约束建议：

1. **同 Topic 约束**：`FOREIGN KEY (topic_id, argument_id) REFERENCES arguments(topic_id, id)`，保证 stake 不会跨 topic 指向 argument。
2. `votes` 建议限制在 `1..10`（由资金池天然限制，但 DB 级约束更稳健）：`CHECK (votes BETWEEN 1 AND 10)`
3. `cost` 建议强一致：`CHECK (cost = votes * votes)`

> `setVotes(targetVotes=0)` 建议语义为删除该 stake 行（而不是存 `votes=0`），这样可以保持 `votes>0` 的约束与索引更干净。

### 3.5 `camps`（聚类阵营）

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `topic_id` | `uuid` | PK（part）FK → `topics.id`；index | 所属 Topic |
| `cluster_id` | `int` | PK（part） | HDBSCAN label（`>=0`；噪声点不建 camp 行） |
| `label` | `text` | nullable | 可选人工/AI 标签 |
| `summary` | `text` | nullable | AI 阵营摘要 |
| `params` | `jsonb` |  | UMAP/HDBSCAN 参数、阈值等（便于回溯） |
| `computed_at` | `timestamptz` | index | 生成时间 |

### 3.6 `cluster_data`（God View 2D 坐标）

复合主键：`(topic_id, argument_id)`（每个 Argument 在 latest 下最多一条）

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `topic_id` | `uuid` | FK → `topics.id` | 所属 Topic |
| `argument_id` | `uuid` | FK → `arguments.id` | 对应节点 |
| `cluster_id` | `int` | nullable；FK → `camps(topic_id, cluster_id)` | outlier/noise 存 NULL（API 可映射为 `-1`） |
| `umap_x` | `double precision` |  | 2D 坐标 |
| `umap_y` | `double precision` |  | 2D 坐标 |
| `computed_at` | `timestamptz` |  | 生成时间 |

写入策略（与架构一致）：

- v1.0 仅保留 latest：每次重算可先 `DELETE FROM cluster_data WHERE topic_id=?`、`DELETE FROM camps WHERE topic_id=?`，再批量插入最新结果。

### 3.7 `consensus_reports`（共识报告，可后置）

| 字段 | 类型 | 约束/索引 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK | 报告 ID |
| `topic_id` | `uuid` | FK → `topics.id`；index | 所属 Topic |
| `status` | `report_status` | index | `generating / ready / failed` |
| `content_md` | `text` | nullable | 最终报告（Markdown/富文本） |
| `model` | `text` | nullable | 例如 `deepseek/deepseek-v3.2` |
| `prompt_version` | `text` | nullable | Prompt Chaining 版本 |
| `params` | `jsonb` | nullable | 生成参数（输入口径/抽样策略等，可回溯） |
| `metadata` | `jsonb` | nullable | 元数据（失败时写入 error 等） |
| `computed_at` | `timestamptz` | index | 生成时间 |
| `created_at` | `timestamptz` |  | 创建时间 |

## 4. 枚举类型

建议用 PostgreSQL enum（或用 text + check 约束，视 Prisma 迁移策略而定）：

- `topic_status`: `active`, `frozen`, `archived`
- `argument_analysis_status`: `pending_analysis`, `ready`, `failed`
- `report_status`: `generating`, `ready`, `failed`

## 5. 关键索引（围绕读路径）

面向 `GET /v1/topics/:topicId/tree?depth=3` 与 `GET /v1/arguments/:argumentId/children`：

1. `arguments(topic_id, parent_id, total_votes DESC)`（children “最热”）
2. `arguments(topic_id, parent_id, created_at DESC, id DESC)`（Dialogue Stream “最新”，cursor 分页更稳定）
3. `arguments(topic_id) WHERE parent_id IS NULL` unique（强制单 Root）
4. `arguments(topic_id, pruned_at)` 或 `arguments(topic_id) WHERE pruned_at IS NULL`（过滤 pruned）
5. `stakes(topic_id, voter_pubkey)`（查询我的质押/更新 ledger 时可用）
6. `ledgers(topic_id, pubkey)` PK 已覆盖批量查询（`WHERE (topic_id,pubkey) IN (...)`）

向量索引（可选，v1.0 不强依赖）：

- 若需要语义检索：`USING hnsw` 或 `ivfflat`（取决于 pgvector 版本与数据规模）；聚类批处理通常全量扫描，不依赖 ANN 索引。

## 6. 事务与一致性（写路径设计）

### 6.1 `createTopic`（创建 Topic + Root Argument）

同一事务内：

1. 插入 `topics(id, title, status=active, ...)`
2. 插入 Root `arguments(topic_id, parent_id=NULL, title, body, author_pubkey, analysis_status=pending_analysis, total_votes=0, total_cost=0, ...)`
3. 更新 `topics.root_argument_id = root_argument.id`（并保持 `topics.title` 与 Root 同步）

### 6.2 `createArgument`（可选携带 `initialVotes`）

同一事务内：

1. 插入 `arguments(...)`（先落 raw 文本，`analysis_status=pending_analysis`）
2. 若携带 `initialVotes`：
   - 读取/初始化 `ledgers(topic_id, pubkey)`（没有则创建 `balance=100`）
   - 计算 `delta_cost = targetVotes^2 - currentVotes^2`（此处 currentVotes=0）
   - 原子更新 `ledgers.balance -= delta_cost`，并更新 `total_*_staked`
   - 插入 `stakes(...)`
   - 原子更新 `arguments.total_votes += delta_votes`、`arguments.total_cost += delta_cost`

余额不足则整笔回滚（避免“有观点无票”的中间态，符合架构决策）。

### 6.3 `setVotes`（投票/撤回）

同一事务内（并使用 `SELECT ... FOR UPDATE` 锁住必要行）：

1. 读取 `arguments` 与 `topics`（校验 `topic.status`、`pruned_at`；对 pruned 或 Read-Only 状态禁止加票，仅允许减票/撤回）
2. 读取/锁定 `ledgers(topic_id, voter_pubkey)`
3. 读取/锁定 `stakes(topic_id, argument_id, voter_pubkey)`（可空）
4. 计算 `delta_votes` 与 `delta_cost`
5. 校验 `ledger.balance - delta_cost >= 0`（当 `delta_cost>0` 时）
6. 更新/插入/删除 `stakes`
7. 更新 `ledgers.balance/total_votes_staked/total_cost_staked/last_interaction_at`
8. 原子更新 `arguments.total_votes/total_cost`

幂等（架构决策）：`nonce` 作为 Idempotency Key（Redis 5 分钟缓存）。数据库层可不存 nonce；如需跨重启幂等，可增加 `request_dedup` 表（v1.0 可选）。

## 7. Pruning / Topic 状态的数据库语义

### 7.1 Topic 状态

- `active`：允许发言、投票、Host 命令
- `frozen`：只读讨论（禁止新增节点/加票；允许用户撤回既有质押）
- `archived`：只读不可逆（禁止新增节点/加票；允许用户撤回既有质押）

### 7.2 Pruning（隐藏节点）

数据库层：

- 在 `arguments.pruned_at/prune_reason` 记录隐藏信息；不物理删除
- 聚类任务读取 embeddings 时必须 `WHERE pruned_at IS NULL`

API 层（读取侧）：

- Focus View：普通用户 tree/children 接口默认不返回 pruned 节点（或返回占位，且不可展开）
- 权重：渲染时将 pruned 节点视为 `Stake_self=0`，并从父子聚合中剔除（避免幽灵权重）

API 层（写入侧）：

- 决策：pruned 节点**不自动退款**，但允许手动撤回；对该节点 `setVotes` 禁止加票，仅允许减票/撤回（`targetVotes <= currentVotes`）。
- 补救：为避免用户因节点被隐藏而无法找回资金，需提供“列出我的质押（包含 pruned）”的读取能力（按 `(topicId, pubkey)` 查询，不建立跨 Topic 关联）。

## 8. 口径统一（v1.0）

1. **Pruning 资金规则（方案 B）**：不自动退款；允许用户手动撤回；对 pruned 节点禁止加票，仅允许减票/撤回（`targetVotes <= currentVotes`）。
2. **QV 展示口径**：UI 默认排序/尺寸/连线粗细统一按 `Total Votes`；`total_cost/cost` 为次要信息，仅用于交易确认弹窗与资金明细（ledger）。
3. **Embedding 维度**：固定为 `vector(4096)`（pgvector 列定义必须匹配维度；API 校验亦应固定长度）。
