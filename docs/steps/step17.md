# Step 17 — Web：“我的 / My Activity”（匿名资产聚合）（M4-匿名性闭环②）

## 目标

实现“后端零知晓 + 纯客户端聚合”的我的页面：

- 本地记录访问过的 `topicId` 列表
- 批量余额：`POST /v1/user/batch-balance`（item 级签名）
- 单 Topic 质押：`GET /v1/topics/:topicId/stakes/me`（含 pruned）
- 一键撤回：对每个 stake 调用 `setVotes(0)`

来源：`docs/prd.md#2.5`、`docs/core-flows.md#5`、`docs/api-contract.md` 3.9/3.10/3.7。

## 依赖

- Step 11、Step 16

## 范围（本 step 做/不做）

- 做：
  - 纯客户端 topicId 聚合（后端不存）
  - 展示余额/质押/撤回
  - pruned 节点质押可见且可撤回
- 不做：
  - 复杂统计（图表/时间线）与导出（可后置）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite W — Web 端到端验收：W5，及 Suite F）。

- [ ] 本地 topic 记录：
  - 进入 topic 页面会把 topicId 追加到本地集合（去重）
- [ ] batch-balance：
  - items 逐项签名
  - 单项失败不影响其它项展示
  - topic 不存在/验签失败：该项展示为失败且包含可读错误（不影响其它 topic）
- [ ] stakes/me：
  - pruned stake 仍显示（标记为 pruned）
- [ ] 一键撤回：
  - 对每个 stake 发送 `setVotes(0)`（可串行，避免把 API 打爆）
  - 任一撤回失败不会导致状态错乱（展示失败项并可重试）

### 服务器验收（推荐 Playwright，黑盒）

- [ ] 部署 API/Web：`coolify deploy name <api_app_name>`、`coolify deploy name <web_app_name>`
- [ ] 访问过的 topics 在“我的”中可见（纯客户端聚合，不依赖服务端）
- [ ] pruned 的 stake 在“我的”中可见且可撤回成功（资金返还到 ledger）

## 2) Green：最小实现（让测试通过）

- `apps/web`：
  - 本地存储：`VisitedTopicsStore`（IndexedDB/LocalStorage 二选一，先简单）
  - My Activity 页面：
    - 拉 batch balance
    - 选择 topic → 拉 stakes/me
    - Withdraw all：对 items 逐个 `setVotes(0)`，完成后刷新 ledger/stakes

## 3) Refactor：模块化与收敛

- [ ] 把“批量签名请求”封装成 `buildBatchBalanceItems(topicIds)`（避免 UI 层拼签名细节）
- [ ] 加入并发上限（例如 2~3）与退避重试（避免大量 stake 时体验崩）

## 4) 验收

- 命令
  - 服务器验收（推荐）：`coolify deploy name <api_app_name>`、`coolify deploy name <web_app_name>`
  - 本地快速反馈（可选）：`pnpm -C apps/web test`
- 验收点
  - [ ] 清空本地后，通过助记词恢复同一身份与余额（同 topic）
  - [ ] pruned 节点质押在“我的”可见并可撤回
