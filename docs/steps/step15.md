# Step 15 — Web：发言 + 投票 + SSE 失效刷新（M3-写路径 UI）

## 目标

在 Web 端跑通最小闭环：

- 发言：`POST /v1/topics/:topicId/arguments`
- 投票/撤回：`POST /v1/arguments/:argumentId/votes`
- SSE：订阅 `/v1/sse/:topicId`，收到 invalidation 后做 query invalidate（去抖 3s）

来源：`docs/roadmap.md` M3、`docs/core-flows.md#2/#3/#4`。

## 依赖

- Step 05、Step 09、Step 10、Step 12、Step 14

## 范围（本 step 做/不做）

- 做：
  - 发言输入（可先用简单 textarea；TipTap 可后置）
  - 投票 slider（step=1，0..10）+ QV cost 提示 + 余额展示
  - SSE 订阅与去抖刷新
  - 最小签名：为当前 topic 生成/缓存一个 Ed25519 keypair，并对写请求/私密读按 v1 规则签名（不要求助记词恢复）
- 不做：
  - 助记词备份/恢复与“可迁移身份”（Step 16）

## 1) Red：先写测试

- [ ] 发言：
  - 提交成功后，UI 将新节点插入（或触发刷新）
  - 余额不足时显示明确错误（402）
- [ ] 投票：
  - slider 改变时显示 cost（`votes^2`）与 delta
  - 提交后 UI 与后端回执一致（以 ledger 为真源）
- [ ] SSE：
  - 收到 `argument_updated` 后触发 `tree/children` 重新拉取（去抖 3s）
  - 收到 `reload_required` 时触发全量刷新（或提示用户刷新）
- [ ] 签名：
  - 写请求/私密读自动带 `X-Pubkey/X-Signature/X-Timestamp/X-Nonce`
  - canonical message 的 `BODY_HASH` 基于 raw body string（与 `packages/crypto` 一致）

## 2) Green：最小实现（让测试通过）

- `apps/web`：
  - 发言：调用 createArgument，成功后更新本地 cache（或简单 re-fetch）
  - 投票：调用 setVotes，使用响应中的 ledger 更新 UI
  - SSE：EventSource + Last-Event-ID（浏览器自动）+ debounce invalidate
  - 最小签名：topic 维度的临时 keypair（例如 `localStorage` 存 seed32），统一由 API client 注入签名 headers（createTopic 除外）

## 3) Refactor：模块化与收敛

- [ ] 把 SSE 订阅封装成 `useTopicSse(topicId)`，对外只暴露 invalidation 信号
- [ ] 投票交互拆分：展示层（cost/余额）与请求层（setVotes）分离
- [ ] 抽 `Signer`/`KeyStore` 接口（Step 16 用助记词派生替换 key 来源）

## 4) 验收

- 命令
  - `pnpm -C apps/web test`
  - 两窗口手动验收：同时打开同一 topic
- 验收点
  - [ ] 发言/投票后另一窗口在秒级更新（无需手动刷新）
