# Step 09 — Argument：发言写入（含 optional `initialVotes`）（M2-写路径①）

## 目标

实现 `POST /v1/topics/:topicId/arguments`：创建 Argument，并在同一事务内支持可选 `initialVotes`（余额不足则整笔失败，不产生 Argument）。

来源：`docs/api-contract.md` 3.6，时序见 `docs/core-flows.md#3`。

## 依赖

- Step 02、Step 03、Step 04、Step 06

## 范围（本 step 做/不做）

- 做：
  - `createArgument`（签名 + topic/status 校验 + parent 校验）
  - `initialVotes`：同事务扣费、写 stake、更新 ledger 与 argument totals
  - `analysisStatus=pending_analysis`（AI 回填在 Step 18）
- 不做：
  - 子回复列表/排序（已在 Step 08）
  - `setVotes`（Step 10）

## 1) Red：先写测试

### API e2e（supertest）

- [ ] 需要签名：无签名 → `401 INVALID_SIGNATURE`
- [ ] topic 不存在 → `404 TOPIC_NOT_FOUND`
- [ ] parent 不存在 → `404 ARGUMENT_NOT_FOUND`
- [ ] topic.status 非 `active` 时拒绝写入（`409 TOPIC_STATUS_DISALLOWS_WRITE`）
- [ ] `initialVotes`：
  - 余额不足 → `402 INSUFFICIENT_BALANCE`，且 DB 中 **不产生** argument
  - 余额足够 → 同一事务内：
    - 创建 argument（`analysisStatus=pending_analysis`）
    - upsert stake（votes/cost）
    - 更新 ledger（balance/totalCostStaked/totalVotesStaked）
    - 更新 argument totals（`totalVotes/totalCost`）

可选（推荐）：

- [ ] 成功写入后，Redis Stream `topic:events:{topicId}` 有一条 `argument_updated` invalidation（SSE endpoint 在 Step 12）

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - `POST /v1/topics/:topicId/arguments` controller/service
  - DB 事务（参考 `docs/database.md#6.2`）：
    - insert argument（pending）
    - 若 `initialVotes>0`：
      - 初始化/锁定 ledger（`FOR UPDATE`）
      - 用 `packages/core-logic` 计算 deltaCost
      - 更新 ledger + stake + argument totals
  - 成功后 enqueue AI job（可先只写入队列表/Redis 标记；BullMQ Worker 在 Step 18）

## 3) Refactor：模块化与收敛

- [ ] 写路径只做编排：成本计算/边界校验全部走 `packages/core-logic`
- [ ] 把 “初始化 ledger（balance=100）” 固化成可复用 helper（createArgument/setVotes 共用）

## 4) 验收

- 命令
  - `docker compose up -d postgres redis`
  - `pnpm -C apps/api test`
- 验收点
  - [ ] 对照契约：响应中 argument/ledger 字段口径一致
  - [ ] 余额不足不会产生脏数据（无 argument、无 stake、ledger 不变）

