# Step 09 — Argument：发言写入（含 optional `initialVotes`）（M2-写路径①）

## 目标

实现 `POST /v1/topics/:topicId/arguments`：创建 Argument，并在同一事务内支持可选 `initialVotes`（余额不足则整笔失败，不产生 Argument）。

来源：`docs/stage01/api-contract.md` 3.6，时序见 `docs/stage01/core-flows.md#3`。

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

对照全量规划：`docs/stage01/test-plan.md`（Suite D — Flow 3：发言 + initialVotes）。

### API e2e（supertest）

- [ ] 需要签名：无签名 → `401 INVALID_SIGNATURE`
- [ ] timestamp 超窗 → `401 TIMESTAMP_OUT_OF_RANGE`（对齐鉴权层）
- [ ] nonce 重放 → `409 NONCE_REPLAY`
- [ ] topic 不存在 → `404 TOPIC_NOT_FOUND`
- [ ] parent 不存在 → `404 ARGUMENT_NOT_FOUND`
- [ ] topic.status 非 `active` 时拒绝写入（`409 TOPIC_STATUS_DISALLOWS_WRITE`）
- [ ] 请求体校验：
  - 缺少 `parentId` 或 `body` → `400 BAD_REQUEST`
  - `initialVotes` 不传等价于 `0`（响应与 DB 结果一致）
  - （可选）`initialVotes` 非整数或 <0 或 >10 → `400 BAD_REQUEST`
- [ ] pruned parent 允许回复：当 parent `prunedAt != null` 时仍可创建子 argument（契约明确允许）
- [ ] `initialVotes`：
  - 余额不足 → `402 INSUFFICIENT_BALANCE`，且 DB 中 **不产生** argument
  - 余额足够 → 同一事务内：
    - 创建 argument（`analysisStatus=pending_analysis`）
    - upsert stake（votes/cost）
    - 更新 ledger（balance/totalCostStaked/totalVotesStaked）
    - 更新 argument totals（`totalVotes/totalCost`）
    - `cost == votes^2` 且 `balance + totalCostStaked == 100`
- [ ] `authorId`：响应中的 `argument.authorId` 必须等于 `sha256(pubkey_bytes).hex().slice(0,16)`（见 `docs/stage01/api-contract.md#2.4`）
- [ ] 契约校验：响应能被 `shared-contracts` parse（字段名/类型一致）

可选（推荐）：

- [ ] （端到端）在 Step 18 完成后：argument 在 worker 回填时会触发 `argument_updated(reason="analysis_done")`（用于两窗口同步）

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - `POST /v1/topics/:topicId/arguments` controller/service
  - DB 事务（参考 `docs/stage01/database.md#6.2`）：
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

> 前置：先按 `docs/stage01/coolify-target.md` export 环境变量（通用手册：`docs/stage01/coolify-acceptance.md`）。

### 服务器验收（推荐）

```bash
# 部署 API
coolify deploy name "$API_APP_NAME" --force
coolify app logs "$API_APP_UUID" -n 200

# 发言（签名，initialVotes=0）
node scripts/coolify/signed-request.mjs POST /v1/topics/<topicId>/arguments \
  '{"parentId":"<parentId>","title":null,"body":"E2E::arg","initialVotes":0}'

# 发言 + initialVotes（签名，initialVotes=3）
node scripts/coolify/signed-request.mjs POST /v1/topics/<topicId>/arguments \
  '{"parentId":"<parentId>","title":null,"body":"E2E::arg+votes","initialVotes":3}'
```

验收点：

- [ ] 发言成功返回 `argument` + `ledger`
- [ ] `initialVotes=3` 时：`cost=9`，`balance` 减少 9
- [ ] 对照契约：响应中 argument/ledger 字段口径一致
- [ ] 余额不足不会产生脏数据（无 argument、无 stake、ledger 不变）

### 本地快速反馈（可选）

```bash
docker compose up -d postgres redis
pnpm -C apps/api test
```

验收点：

- [ ] e2e 测试通过
