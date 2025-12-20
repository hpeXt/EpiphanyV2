# Step 10 — QV：`setVotes`（强幂等 + 不变量）（M2-写路径②）

## 目标

实现 `POST /v1/arguments/:argumentId/votes`（`setVotes(targetVotes)`）并满足：

- DB 事务强一致（账本为真源）
- pruned/frozen/archived 限制：只允许减票/撤回
- 强幂等：同 `(pubkey, nonce)` 重放返回同响应（Redis 缓存 5 分钟）

来源：`docs/api-contract.md` 3.7、`docs/core-flows.md#4`、`docs/roadmap.md` 0.2。

## 依赖

- Step 03、Step 04、Step 06、Step 09

## 范围（本 step 做/不做）

- 做：
  - `setVotes` 事务（lock ledger/stake/argument）
  - 约束：`targetVotes` 0..10、余额不足、pruned/只读限制
  - 强幂等缓存（仅成功响应缓存）
- 不做：
  - SSE endpoint（Step 12；但可以先写入 Redis Stream）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite E — Flow 4：QV setVotes）。

### API e2e（supertest）

- [ ] 需要签名：无签名 → `401`
- [ ] timestamp 超窗 → `401 TIMESTAMP_OUT_OF_RANGE`
- [ ] argument 不存在 → `404 ARGUMENT_NOT_FOUND`
- [ ] `targetVotes` 越界/非整数 → `400 BAD_REQUEST`
- [ ] 余额不足 → `402 INSUFFICIENT_BALANCE`，且 stake/ledger/argument totals 都不变
- [ ] 增票/减票：
  - `0 -> 4`：balance 减 16；stake=4；argument.totalVotes+=4
  - `4 -> 1`：balance 加 15；stake=1；argument.totalVotes 变更正确
  - `x -> 0`：删除 stake 行（建议策略），ledger/argument totals 回滚正确
- [ ] 响应字段自洽：
  - `previousCost == previousVotes^2`、`targetCost == targetVotes^2`
  - `deltaVotes == targetVotes - previousVotes`
  - `deltaCost == targetCost - previousCost`
- [ ] 不变量：`balance + totalCostStaked == 100` 恒成立
- [ ] pruned 限制：argument.prunedAt != null 时，`targetVotes > currentVotes` → `409 ARGUMENT_PRUNED_INCREASE_FORBIDDEN`
- [ ] topic 只读限制：topic.status=frozen/archived 时，`targetVotes > currentVotes` → `409 TOPIC_STATUS_DISALLOWS_WRITE`
- [ ] 强幂等：
  - 同 nonce 重放：第二次请求不进入事务计算，直接返回第一次的 200 响应（字段完全一致）
  - 幂等缓存 TTL 至少 5 分钟（可用 fake timers 或 Redis TTL 断言）
  - 同 nonce 但不同请求体（例如先 `targetVotes=3` 再重放 `targetVotes=1`）→ 返回第一次成功响应，且 DB 不应被第二次请求改变
  - 同 `(pubkey, nonce)` 作用于不同 argument → 返回第一次成功响应（按 `docs/api-contract.md#1.4` 的 `(pubkey, nonce)` 幂等键口径），且第二个 argument 不应被改变
- [ ] 契约校验：响应能被 `shared-contracts` parse（字段名/类型一致）
- [ ] （推荐）成功投票/撤回后写入 SSE invalidation：`argument_updated(reason="new_vote")`（写入 Redis Stream，SSE endpoint 在 Step 12）

### Coolify CLI 服务器验收（黑盒）

运行手册：`docs/coolify-acceptance.md`。

- [ ] 部署 API：`coolify deploy name <api_app_name>`
- [ ] setVotes（签名）：
  - `node scripts/coolify/signed-request.mjs POST /v1/arguments/<argumentId>/votes '{"targetVotes":4}'`
  - `node scripts/coolify/signed-request.mjs POST /v1/arguments/<argumentId>/votes '{"targetVotes":0}'`

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - `POST /v1/arguments/:argumentId/votes` controller/service
  - Redis idempotency：
    - key：`idemp:setVotes:{pubkey}:{nonce}`
    - value：序列化成功响应（5 min TTL）
  - DB 事务（参考 `docs/database.md#6.3`）：
    - `SELECT ... FOR UPDATE`：topic、argument、ledger、stake
    - 校验 pruned/status
    - 用 `packages/core-logic` 计算 delta
    - 更新 ledger + stake(upsert/delete) + argument totals
  - 成功后写入 Redis Stream invalidation：`argument_updated(reason="new_vote")`

## 3) Refactor：模块化与收敛

- [ ] 把“idempotency read/write”封装成 service（避免 controller/service 到处拼 key）
- [ ] 将错误码映射集中管理（对齐 `shared-contracts`）

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `node scripts/coolify/signed-request.mjs POST /v1/arguments/<argumentId>/votes '{"targetVotes":4}'`
    - `node scripts/coolify/signed-request.mjs POST /v1/arguments/<argumentId>/votes '{"targetVotes":0}'`
  - 本地快速反馈（可选）：
    - `docker compose up -d postgres redis`
    - `pnpm -C apps/api test`
- 验收点
  - [ ] 并发/重放下不变量成立（至少用测试覆盖重放）
  - [ ] pruned/只读限制只影响“增票”，不阻断撤回
