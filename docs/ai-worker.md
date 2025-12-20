# AI Worker 模块设计（v1.0）

> 本文档补齐异步 AI 任务（BullMQ Worker）与可选 Python 计算服务（FastAPI）的实现设计，作为落地 `docs/architecture.md` 的细化说明。
>
> 对齐文档：
> - `docs/prd.md`：AI 治理目标（立场/聚类/共识报告）
> - `docs/api-contract.md`：SSE 事件与对外数据口径
> - `docs/database.md`：`arguments/camps/cluster_data/consensus_reports` 等表结构与约束
> - `docs/core-flows.md`：端到端时序

本文档术语约定：

- **API**：`apps/api`（NestJS），提供 HTTP + SSE，对外唯一入口。
- **Worker**：Node.js 进程（BullMQ consumer），执行异步 AI 任务并写 DB/发事件。
- **AI Worker（可选）**：Python/FastAPI 计算服务，仅承担重 CPU 的 UMAP/HDBSCAN（必要时可扩展）。

---

## 1. 目标与边界

### 1.1 目标

- **快速写路径**：`createArgument/setVotes` 不阻塞 AI 计算；AI 结果异步回填（`analysisStatus` / `cluster_data`）。
- **可重复与可回溯**：聚类参数、模型版本、计算时间可追踪（`camps.params` / `computed_at` / `modelVersion`）。
- **幂等与容错**：Job 可重试；对同一实体（argument/topic）重复执行不产生错误或数据膨胀。
- **弱耦合可替换**：AI Provider、聚类引擎（Node vs Python）可切换，不影响对外 API 契约。

### 1.2 非目标（v1.0）

- 不设计“实时流式生成报告”的前端交互（SSE 只做 invalidation）。
- 不做跨 Topic 的用户画像/关联（严格遵循匿名性边界）。
- 不引入复杂的工作流编排系统（Temporal/Airflow）；BullMQ 足够覆盖 MVP。

---

## 2. 系统关系（数据流）

```mermaid
flowchart LR
  Web[Web apps/web] -->|HTTP| API[API apps/api]
  Web <-->|SSE /v1/sse/:topicId| API

  API -->|TX| DB[(PostgreSQL)]
  API -->|enqueue| Redis[(Redis / BullMQ)]

  Redis -->|jobs| Worker[Worker Node/BullMQ]
  Worker -->|TX writeback| DB
  Worker -->|XADD topic:events:{topicId}| Redis

  API -->|XREAD/XRANGE| Redis
  API -->|SSE invalidation| Web

  Worker -. optional .->|HTTP| Py[AI Worker Python/FastAPI]
```

事件策略（与 `docs/architecture.md` 一致）：

- API 与 Worker 都可以作为事件生产者，统一写入 Redis Stream：`topic:events:{topicId}`。
- SSE 端点由 API 进程提供：读取 Redis Stream，按 `Last-Event-ID` 补发或发送 `reload_required`。
- 事件只推 **Entity Invalidation**（`id + reason`）；前端自行 `invalidate` 后拉取最新实体。

---

## 3. BullMQ 队列与 Job 定义

> 命名目标：可读、可观测、可按任务类型限流。

### 3.1 队列（Queues）

建议队列划分：

- `ai:argument-analysis`：单 Argument 分析（立场判定 + embedding）
- `ai:topic-cluster`：Topic 级聚类（UMAP + HDBSCAN）
- `ai:consensus-report`：（后置）共识报告生成（Prompt chaining）

### 3.2 Job 幂等策略（关键）

BullMQ 层：

- `argument-analysis`：`jobId = "arg:" + argumentId`
- `topic-cluster`：`jobId = "cluster:" + topicId`（用于 debounce：同一 topic 5 分钟内最多一个 pending job）
- `consensus-report`：`jobId = "report:" + reportId`

DB 层（最终幂等）：

- `arguments.analysis_status` 为 `ready` 时，分析 Job **直接短路返回**（不重复调用 AI Provider）。
- 聚类 Job 写入采用 **覆盖 latest**（先删后插，见 `docs/database.md` 3.6 写入策略），天然幂等。

### 3.3 重试与退避（建议值）

- 外部 AI Provider：3 次重试，指数退避（例如 5s/20s/60s），总超时有上限。
- 聚类：2 次重试（CPU 重任务重试成本高），失败后保留旧 `cluster_data`（不写入半成品）。

> 注意：重试必须保证“重复执行不破坏数据”，因此写 DB 应尽量在最后一步且用事务。

---

## 4. Job：Argument 分析（立场 + Embedding）

### 4.1 触发点

- `POST /v1/topics/:topicId/arguments` 成功落库后，由 API enqueue：`ai:argument-analysis`（payload `{ argumentId }`）。

### 4.2 输入/输出（内部契约）

输入（Job payload）：

```json
{ "argumentId": "uuidv7" }
```

输出（写回 DB，字段对齐 `docs/database.md`）：

- `arguments.analysis_status`: `ready | failed`
- `arguments.stance_score`: `[-1,1]`（失败则 NULL）
- `arguments.embedding`: `vector(4096)`（失败则 NULL）
- `arguments.embedding_model`: `text`
- `arguments.metadata`: JSON（可存 `provider_latency_ms`、`error_code` 等）

### 4.3 处理步骤（推荐实现顺序）

1. 读 DB：加载 `argument` 与 `parent`（需要 parent 文本用于“相对立场”）。
2. 幂等短路：若 `analysis_status == ready`，直接返回（避免重复计费）。
3. 调用 LLM（立场判定）：
   - 输入：`parent.body` + `argument.body`
   - 输出：`stanceScore`（float，范围 [-1,1]；解析失败视为错误）
4. 调用 Embedding：
   - 输入文本：`title + "\n\n" + body`（title 为空则只用 body）
   - 输出：4096 维向量（float32/float64 均可，落库时按 pgvector）
5. DB 事务写回：
   - 更新 `arguments.(analysis_status, stance_score, embedding, embedding_model, metadata, updated_at)`
6. 生产 SSE invalidation：
   - `XADD topic:events:{topicId}` 写入 `argument_updated`，`reason="analysis_done"`（成功/失败都用同一 reason；前端拉取后根据 `analysisStatus` 渲染）。
7. 触发聚类 debounce（建议）：
   - enqueue `ai:topic-cluster`（delay=5min，`jobId="cluster:"+topicId`；重复 enqueue 忽略）。

### 4.4 失败语义

- `analysis_status=failed` 时：
  - `stance_score/embedding` 置 NULL；
  - `metadata` 记录失败原因（例如 `{ "error": { "provider":"...", "code":"TIMEOUT" } }`）；
  - 同样发送 `argument_updated(reason="analysis_done")`，保证前端能从 “pending” 变为 “failed”。

---

## 5. Job：Topic 聚类（UMAP + HDBSCAN）

### 5.1 触发与节流（对齐架构决策）

触发来源（任意满足即可尝试调度）：

- 新 argument 完成 embedding 回填（analysis_done）
- 投票变化（new_vote）
- pruning（pruned）

节流规则（v1.0，来自 `docs/architecture.md`）：

- **Debounce**：5 分钟内最多跑一次（通过 BullMQ `jobId="cluster:"+topicId` + delay 实现）
- **阈值**：满足其一才真正执行计算
  - `new_arguments >= 5`（过滤 pruned，且要求 embedding ready）
  - `total_votes_change >= 20%`（过滤 pruned）

阈值计算建议依赖 DB 的 `topics.last_cluster_*` 三元组：

- `topics.last_clustered_at`
- `topics.last_cluster_argument_count`
- `topics.last_cluster_total_votes`

口径（建议在 Worker 代码里定义成同名函数，避免漂移）：

- `clusterable_argument_count`：`COUNT(arguments)` 其中 `pruned_at IS NULL AND analysis_status='ready' AND embedding IS NOT NULL`
- `clusterable_total_votes`：对同一集合求和：`SUM(arguments.total_votes)`
- `new_arguments = clusterable_argument_count - last_cluster_argument_count`
- `total_votes_change_ratio = ABS(clusterable_total_votes - last_cluster_total_votes) / GREATEST(1, last_cluster_total_votes)`
  - 当 `last_cluster_total_votes=0` 时，比例阈值几乎一定成立；因此建议优先用 `new_arguments>=5` 作为“首次聚类/冷启动”的主触发条件。

### 5.2 读取口径（必须一致）

聚类输入（严格遵循 PRD）：

- 只用 `arguments.embedding` 做语义聚类；**禁止使用立场分**参与聚类特征。
- 过滤：
  - `arguments.pruned_at IS NULL`
  - `arguments.analysis_status = ready`
  - `arguments.embedding IS NOT NULL`

### 5.3 输出口径（写回 DB + 对外 API）

写回表（对齐 `docs/database.md` 3.5/3.6）：

- `camps`：为 `cluster_id >= 0` 的簇写入一行（噪声点不建 camp）
  - `params`：记录 UMAP/HDBSCAN 参数与版本（例如 `{ umap:{...}, hdbscan:{...}, engine:"python" }`）
- `cluster_data`：为每个 argument 写入 `umap_x/umap_y/cluster_id/computed_at`
  - 噪声/离群点：`cluster_id=NULL`（对外映射为 `-1`）

对外 `GET /v1/topics/:topicId/cluster-map`：

- `x/y` 归一化到 `[-1,1]`
- `clusterId`：`-1` 表示噪声（与 `cluster_id=NULL` 对应）
- `weight`：`log(totalVotes + 1)`（仅用于渲染大小；不是聚类特征）
- `centroid`：与 points 同一坐标系（归一化后）；可在读接口聚合计算，也可在 Worker 计算后放入 `camps.params.centroid`（v1.0 推荐读时算，避免冗余写入）

### 5.4 推荐默认参数（可回溯）

UMAP（2D）：

- `n_components=2`
- `metric="cosine"`
- `n_neighbors=15`（样本很少时可下调到 `min(15, n-1)`）
- `min_dist=0.1`
- `random_state=42`

HDBSCAN：

- `metric="euclidean"`（对 UMAP 输出空间聚类）
- `min_cluster_size=max(5, floor(n*0.02))`（n 为参与聚类的点数）
- `min_samples`：默认等于 `min_cluster_size` 或 `None`（二者择一并固化）
- `cluster_selection_method="eom"`

> 参数必须写入 `camps.params`，便于回滚/对比。

### 5.5 执行步骤（Worker 侧）

1. 读取 DB：计算当前 `argument_count/total_votes`（过滤 pruned），与 `topics.last_cluster_*` 对比，若未达阈值则直接退出。
2. 读取 embeddings：批量拉取 `(argument_id, embedding)`。
3. 计算：
   - 计算引擎可选：Node 本地 or 调用 Python AI Worker（见第 6 节）。
   - 输出：每点 `(argumentId, x, y, clusterId)` + 每簇 centroid。
4. DB 事务写回（同一事务，避免对外读到“半更新”）：
   - `DELETE FROM cluster_data WHERE topic_id=?`
   - `DELETE FROM camps WHERE topic_id=?`
   - 批量插入 `camps` 与 `cluster_data`
   - 更新 `topics.last_clustered_at/last_cluster_argument_count/last_cluster_total_votes`
5. 写事件：`XADD topic:events:{topicId}` → `cluster_updated`

失败语义：

- 若计算失败或写回失败：不更新 `cluster_data/camps`（保留旧结果），不更新 `last_cluster_*`，可重试。

---

## 6. 可选：Python AI Worker（FastAPI）设计

### 6.1 目的

- 承接 CPU/内存密集的 UMAP/HDBSCAN（numpy/scikit-learn/hdbscan），在 Node 侧性能不足时启用。
- 与 BullMQ 解耦：**不直接消费队列**，只提供内部 HTTP 计算接口（Worker 调用）。

### 6.2 部署与安全

- 仅内网可访问（docker network / k8s service），不对公网暴露。
- Worker 调用需携带 `X-Internal-Token: <AI_WORKER_TOKEN>`（共享密钥）或通过网络策略限制源地址。

### 6.3 API（内部）

健康检查：

- `GET /healthz` → `200 { "ok": true, "version": "..." }`

聚类计算（推荐“拉取 DB”模式，避免传输 4096 维大矩阵）：

- `POST /v1/cluster/topic`

请求体：

```json
{
  "topicId": "uuidv7",
  "computedAt": "2025-12-19T12:34:56.789Z",
  "umap": { "nNeighbors": 15, "minDist": 0.1, "randomState": 42, "metric": "cosine" },
  "hdbscan": { "minClusterSize": 8, "minSamples": 8, "clusterSelectionMethod": "eom" }
}
```

服务端行为：

- 通过只读 `DATABASE_URL` 查询该 topic 下可参与聚类的 `(argument_id, embedding)`（过滤 pruned，要求 ready）。
- 计算 UMAP(2D) + HDBSCAN labels，并返回结果。

响应体（最小结果，便于 Worker 写回 DB）：

```json
{
  "topicId": "uuidv7",
  "computedAt": "2025-12-19T12:34:56.789Z",
  "engine": "python",
  "points": [
    { "argumentId": "uuidv7", "x": 0.12, "y": -0.34, "clusterId": -1 }
  ],
  "clusters": [
    { "id": 0, "centroid": { "x": 0.01, "y": 0.02 }, "size": 42 }
  ]
}
```

约定：

- `clusterId=-1` 表示噪声点；Worker 落库时写 `cluster_id=NULL`。
- `x/y` 为 UMAP 原始输出；**归一化到 `[-1,1]` 可在 Python 或 Worker 侧完成，但必须固定一种实现并写入 `camps.params.normalization`**。
  - 推荐 v1.0 归一化：对 x/y 分别做 min-max 到 `[-1,1]`：
    - 若 `max==min` 则该轴全部置 `0`
    - 否则 `x' = 2*(x-min)/(max-min) - 1`（y 同理）

### 6.4 Worker 与 Python 的切换策略

通过环境变量控制：

- `CLUSTER_ENGINE=node|python`
- 当 `CLUSTER_ENGINE=python`：
  - Worker 调用 `AI_WORKER_URL` 的 `/v1/cluster/topic`
  - 超时/异常则回退到 Node（可选）或直接失败重试（默认更安全：失败重试，避免双实现差异）

---

## 7. （后置）共识报告 Job（Prompt Chaining）

> v1.0 可先不实现，但建议提前冻结落库语义与幂等策略（`docs/database.md` 3.7 已预留）。

Job：`ai:consensus-report`

- 输入：`{ topicId, reportId, trigger: "auto"|"host" }`
- DB 写入：
  - `consensus_reports.status = generating|ready|failed`
  - `content_md` 为最终报告（Markdown）
  - `prompt_version` 固化链路版本号（便于回归）
- 事件：建议复用 `topic_updated(reason="root_edited" 不合适)`，更合理的是引入新事件 `report_updated`；但会影响 `docs/api-contract.md`，因此 v1.0 暂不在 SSE 中暴露“报告更新”，由前端轮询或手动刷新获取。

---

## 8. 配置清单（环境变量建议）

Worker（Node）：

- `DATABASE_URL`
- `REDIS_URL`
- `AI_PROVIDER_API_KEY`（或按实际 Provider 拆分多个 key）
- `EMBEDDING_MODEL`（默认：`qwen/qwen3-embedding-8b`）
- `STANCE_MODEL`（默认：`google/gemini-3-flash-preview`）
- `REPORT_MODEL`（默认：`deepseek/deepseek-v3.2`，后置）
- `CLUSTER_ENGINE=node|python`（默认 `node`）
- `AI_WORKER_URL`（当 `CLUSTER_ENGINE=python` 时必填）
- `AI_WORKER_TOKEN`（内部鉴权 token）

AI Worker（Python，可选）：

- `DATABASE_URL`（建议使用只读账号）
- `AI_WORKER_TOKEN`
- `LOG_LEVEL`

---

## 9. 可观测性与隐私

日志与指标（建议）：

- 日志必须包含：`jobId`, `topicId`, `argumentId`（若有），`attempt`, `latency_ms`
- 避免记录完整 `body` 原文（最多记录 hash/长度），降低隐私与日志成本
- 指标：队列深度、成功率、失败码分布、外部 Provider 延迟与限流次数

隐私边界（必须遵守）：

- 不新增任何跨 Topic 的用户关联数据结构。
- AI 输入只包含**当前 Topic 内**的文本（parent/child 或聚类样本），不拼接跨 Topic 历史。
