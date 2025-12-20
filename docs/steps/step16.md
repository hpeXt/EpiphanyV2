# Step 16 — Web 身份系统：助记词 + Topic 派生身份 + 请求签名（M4-匿名性闭环①）

## 目标

在 Web 端实现匿名身份系统（本地保存、可恢复、Topic 级不可关联）：

- 助记词生成/备份/恢复（BIP39）
- 派生 topicKeypair（HMAC-SHA512 → Ed25519）
- 对所有写请求/私密读请求按 v1 签名（headers）

来源：`docs/prd.md#2.5`、`docs/crypto.md`、`docs/api-contract.md#1`。

## 依赖

- Step 05、Step 15（写路径 UI 已有）

## 范围（本 step 做/不做）

- 做：
  - 本地保存 masterSeed（IndexedDB/LocalStorage，后置加密可暂不做，但严禁上报/日志）
  - 用“助记词派生的 topicKeypair”替换 Step 15 的临时 keypair，并注入签名 headers
  - “当前身份指纹”展示（例如 pubkey 前后 6 位）
- 不做：
  - “我的”聚合页（Step 17）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite W — Web 端到端验收：W4，及签名/防重放安全项）。

- [ ] `identity` 模块（纯函数）：
  - 从 mnemonic 恢复得到稳定 masterSeed
  - 对同一 `topicId` 派生出稳定 `pubkey`
  - canonical message 与 `packages/crypto` 一致（空 body 末尾 `|`）
  - `authorId`（展示用）可由 pubkey 稳定派生：`sha256(pubkey).slice(0,16)`（与契约一致）
- [ ] API 调用层：
  - 写请求自动带 `X-Pubkey/X-Signature/X-Timestamp/X-Nonce`
  - 私密读同样带签名
  - 清空本地后重新导入助记词：同一 topic 的 pubkey 必须保持一致（可作为回归测试）

### 服务器验收（Coolify + 黑盒）

- [ ] 部署 API/Web：`coolify deploy name <api_app_name>`、`coolify deploy name <web_app_name>`
- [ ] 浏览器端生成助记词后在同一 topic 内完成一次写请求（发言/投票）不再返回 `INVALID_SIGNATURE`
- [ ] 清空本地存储后导入同一助记词：同一 topic 的 pubkey/余额可恢复（对照 `ledger/me`）

## 2) Green：最小实现（让测试通过）

- `apps/web`：
  - 增加 onboarding（生成/导入助记词）
  - `deriveTopicKeypair(topicId)`（调用 `packages/crypto`）
  - API client 统一签名注入（createTopic 除外）

## 3) Refactor：模块化与收敛

- [ ] 把“签名注入”做成 request middleware（避免每个调用点重复）
- [ ] 把本地存储抽象成 `KeyStore` 接口（便于未来做加密/迁移）

## 4) 验收

- 命令
  - 服务器验收（推荐）：`coolify deploy name <api_app_name>`、`coolify deploy name <web_app_name>`
  - 本地快速反馈（可选）：`pnpm -C apps/web test`
- 验收点
  - [ ] 清空本地后，用同一助记词能恢复同一 pubkey（对同一 topic）
  - [ ] 写请求验签通过（API 不再返回 INVALID_SIGNATURE）
