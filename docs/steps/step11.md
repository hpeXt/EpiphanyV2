# Step 11 — 私密读：`ledger/me`、`stakes/me`、`batch-balance`（M2-My Activity 数据）

## 目标

实现 My Activity 所需的私密读接口（均按签名 v1 校验）：

- `GET /v1/topics/:topicId/ledger/me`
- `GET /v1/topics/:topicId/stakes/me`
- `POST /v1/user/batch-balance`（item 级签名）

来源：`docs/api-contract.md` 3.8/3.9/3.10、流程见 `docs/core-flows.md#5`。

## 依赖

- Step 02、Step 03、Step 05、Step 06、Step 10

## 范围（本 step 做/不做）

- 做：
  - 私密读验签（复用 Step 06 guard）
  - `stakes/me` 必须包含 pruned 节点质押（用于找回资金）
  - `batch-balance`：item 级验签，单项失败不影响其它项
- 不做：
  - Web 的 “我的” 页面（Step 17）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite F — Flow 5：My Activity 数据口径）。

### API e2e

- [ ] `GET /ledger/me`：
  - 需要签名
  - 没有 ledger 时自动初始化为 balance=100（或契约允许的等价行为，必须固定）
  - nonce 重放 → `409 NONCE_REPLAY`
  - topic 不存在 → `404 TOPIC_NOT_FOUND`
  - 契约校验：响应能被 `shared-contracts` parse
- [ ] `GET /stakes/me`：
  - 需要签名
  - 返回我在该 topic 的全部 stake（包含 pruned 的 argument，字段含 `argumentPrunedAt`）
  - 每条 stake 满足 `cost == votes^2`
  - nonce 重放 → `409 NONCE_REPLAY`
  - topic 不存在 → `404 TOPIC_NOT_FOUND`
  - 契约校验：响应能被 `shared-contracts` parse
- [ ] `POST /v1/user/batch-balance`：
  - 该接口本身**不要求**签名 headers（签名在 body 的 items 内）；无 headers 也可请求
  - request `items[]` 每项独立验签：canonical message 等价 `GET /v1/topics/{topicId}/ledger/me` 且 bodyHash 为空（末尾 `|`）
  - 单项验签失败：该项 `ok:false`，其它项仍 `ok:true`
  - topic 不存在：该项 `ok:false` 且 error.code=`TOPIC_NOT_FOUND`
  - 契约校验：整体响应能被 `shared-contracts` parse

### Coolify CLI 服务器验收（黑盒）

运行手册：`docs/coolify-acceptance.md`。

- [ ] 部署 API：`coolify deploy name <api_app_name>`
- [ ] ledger/me（签名 headers）：
  - `node scripts/coolify/signed-request.mjs GET /v1/topics/<topicId>/ledger/me`
- [ ] stakes/me（签名 headers）：
  - `node scripts/coolify/signed-request.mjs GET /v1/topics/<topicId>/stakes/me`
- [ ] batch-balance（item 级签名）：
  - `node scripts/coolify/batch-balance.mjs <topicId1> <topicId2>`

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - `GET /v1/topics/:topicId/ledger/me`
  - `GET /v1/topics/:topicId/stakes/me`（join arguments 取 title/excerpt/prunedAt）
  - `POST /v1/user/batch-balance`：
    - 循环 items：对每项构造 canonical message（GET + path + timestamp + nonce + 空 bodyHash）
    - verify signature（pubkey 为 item.pubkey）
    - 查询该 topic 下的 ledger（不存在则视为 100）

## 3) Refactor：模块化与收敛

- [ ] `batch-balance` 的验签逻辑复用 `packages/crypto` 的 canonical builder（不要手写字符串）
- [ ] `stakes/me` 的 excerpt 规则固化（避免前后端对“截取长度”口径漂移）

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `node scripts/coolify/signed-request.mjs GET /v1/topics/<topicId>/ledger/me`
    - `node scripts/coolify/signed-request.mjs GET /v1/topics/<topicId>/stakes/me`
    - `node scripts/coolify/batch-balance.mjs <topicId1> <topicId2>`
  - 本地快速反馈（可选）：`pnpm -C apps/api test`
- 验收点
  - [ ] pruned 节点的 stake 在 `stakes/me` 可见
  - [ ] batch-balance “item 级隔离失败”成立
