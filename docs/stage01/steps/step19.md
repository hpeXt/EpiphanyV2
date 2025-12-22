# Step 19 — Worker：Topic 聚类（UMAP + HDBSCAN）+ `cluster-map` API（M6-语义地图数据）

## 目标

实现 God View 所需数据闭环：

- Worker：`ai:topic-cluster`（`jobId="cluster_"+topicId`，delay=5min debounce；BullMQ 自定义 jobId 不能包含 `:`）
- 阈值：`new_arguments>=5` 或 `total_votes_change>=20%`（过滤 pruned）
- 落库：覆盖写 `camps/cluster_data` + 更新 `topics.last_cluster_*`
- API：`GET /v1/topics/:topicId/cluster-map`（公共读，坐标归一化 [-1,1]）

来源：`docs/stage01/ai-worker.md#5`、`docs/stage01/core-flows.md#6`、`docs/stage01/api-contract.md` 3.11。

## 依赖

- Step 03、Step 12、Step 18

## 范围（本 step 做/不做）

- 做：
  - 阈值/口径函数固化（避免漂移）
  - 聚类引擎：Node 或 Python（通过 `CLUSTER_ENGINE=node|python` 切换）
  - `cluster_updated` invalidation
- 不做：
  - Web 可视化（Step 20）

## 1) Red：先写测试

对照全量规划：`docs/stage01/test-plan.md`（Suite G — Flow 6：聚类 + cluster-map + SSE）。

- [ ] 阈值逻辑单测：
  - 过滤 pruned，且只统计 `analysis_status=ready & embedding != NULL`
  - `new_arguments`/`total_votes_change_ratio` 计算口径与文档一致
  - debounce：5 分钟内重复 enqueue 不会并发跑两次
- [ ] 写入幂等：
  - 同一 topic 重跑会覆盖 latest（camps/cluster_data 不膨胀）
- [ ] API cluster-map：
  - x/y 归一化到 [-1,1]
  - `clusterId=-1` 表示噪声点（DB NULL 映射）
  - `weight=log(totalVotes+1)`
  - 过滤 pruned：被 pruning 的 argument 不应出现在 points 中
  - 契约校验：响应能被 `shared-contracts` parse
  - 聚类完成后通过 SSE 发 `cluster_updated`（写入 Redis Stream，SSE endpoint 在 Step 12）

## 2) Green：最小实现（让测试通过）

- Worker：
  - 读取可聚类 argument 集合（embedding ready + not pruned）
  - UMAP 2D + HDBSCAN（参数写入 `camps.params`）
  - 事务覆盖写 `camps/cluster_data`（先删后插）
  - 更新 `topics.last_cluster_*`
  - `XADD topic:events:{topicId}` 写 `cluster_updated`
- API：
  - `GET /v1/topics/:topicId/cluster-map`（查询 camps + cluster_data 并做归一化/映射）

## 3) Refactor：模块化与收敛

- [ ] 把“归一化口径”固化成纯函数并单测（避免前后端坐标系漂移）
- [ ] cluster engine 抽象（node/python），参数与版本写入 `camps.params`

## 4) 验收

> 前置：先按 `docs/stage01/coolify-target.md` export 环境变量（通用手册：`docs/stage01/coolify-acceptance.md`）。

### 服务器验收（推荐）

```bash
# 部署 API 和 Worker
coolify deploy name "$API_APP_NAME" --force
coolify deploy name "$WORKER_APP_NAME" --force
coolify app logs "$WORKER_APP_UUID" -n 200

# 查询 cluster-map
curl -fsS "$API_BASE_URL/v1/topics/<topicId>/cluster-map"
```

验收点：

- [ ] 触发聚类后：`cluster-map` 返回可解析结果，并收到 `cluster_updated`
- [ ] >50 节点时能稳定产出 cluster-map（不要求 UI，但 API 输出正确）
- [ ] pruning 后聚类输入过滤 pruned，结果更新

### 本地快速反馈（可选）

```bash
pnpm -C apps/worker test
```

验收点：

- [ ] 聚类相关测试通过
