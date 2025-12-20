# Step 18 — Worker：Argument 分析（stance + embedding）（M5-AI 异步回填）

## 目标

实现最小 AI 闭环：

- API 写入 argument 立即返回（`analysisStatus=pending_analysis`）
- Worker 异步回填 `stanceScore/embedding/analysisStatus`
- 通过 SSE invalidation 触发 Web 刷新并从 pending 变为 ready/failed

来源：`docs/ai-worker.md#4`、`docs/roadmap.md` M5。

## 依赖

- Step 03、Step 09、Step 12、Step 15（Web 已订阅 SSE）

## 范围（本 step 做/不做）

- 做：
  - BullMQ 队列：`ai:argument-analysis`（`jobId="arg:"+argumentId`）
  - 幂等：`analysis_status=ready` 直接短路
  - 成功/失败都发 `argument_updated(reason="analysis_done")`
- 不做：
  - 聚类（Step 19）
  - 真实外部 AI 调用（建议先实现 `AI_PROVIDER=mock`，避免开发期被网络/额度卡住）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite D 的 AI 回填部分 + SSE 专项）。

- [ ] Worker unit/integration：
  - 同一 argument 反复入队：只会写一次（ready 后短路）
  - 失败语义：写 `analysis_status=failed`、`stance_score/embedding=NULL`，仍发事件
  - event：`XADD topic:events:{topicId}` 写入 `argument_updated` + `reason="analysis_done"`
  - embedding 维度：成功时必须写入 4096 维向量；失败时为 NULL
  - `stanceScore` 范围：成功时 clamp/校验在 [-1,1]；非法输出视为失败
- [ ] Web（可选）：
  - pending → ready 的 UI 状态切换（占位样式）

## 2) Green：最小实现（让测试通过）

- 新增 Worker 进程（选项二选一，选一种并固化）：
  - `apps/worker`（推荐，职责清晰），或
  - `apps/api` 内部启动 worker（开发期可行，但边界不清）
- Worker 实现：
  - 从 DB 读取 argument + parent
  - 调用 `AIProvider`：
    - `getStance(parentText, childText) -> [-1,1]`
    - `getEmbedding(text) -> number[4096]`
  - 事务写回 DB
  - 写 Redis Stream 事件

## 3) Refactor：模块化与收敛

- [ ] AIProvider 接口化（mock/real 可切换）
- [ ] 把“写回 + 发事件”封装成单个 service（减少重复与半成品写入）

## 4) 验收

> 前置：先按 `docs/coolify-target.md` export 环境变量（通用手册：`docs/coolify-acceptance.md`）。

### 服务器验收（推荐）

```bash
# 部署 API 和 Worker
coolify deploy name "$API_APP_NAME" --force
coolify deploy name "$WORKER_APP_NAME" --force
coolify app logs "$WORKER_APP_UUID" -n 200

# （可选）SSE 观察
curl -N -H "Accept: text/event-stream" "$API_BASE_URL/v1/sse/<topicId>"
```

手动验收：

- [ ] 创建 argument 后立刻可读（tree/children 能看到 pending 节点）
- [ ] 在 N 秒内（mock 可立即）pending → ready/failed，并通过 SSE 收到 `analysis_done` invalidation

验收点：

- [ ] 新发言在 1~数十秒内从 pending 变为 ready/failed（开发期 mock 可立即）
- [ ] stance 只影响样式，不参与聚类输入（聚类只用 embedding）

### 本地快速反馈（可选）

```bash
pnpm -C apps/worker test
```

验收点：

- [ ] Worker 测试通过
