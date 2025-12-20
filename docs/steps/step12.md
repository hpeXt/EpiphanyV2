# Step 12 — SSE：Redis Stream 事件流 + 续传（M2-实时失效通知）

## 目标

实现 `GET /v1/sse/:topicId`（公共读），并按契约做到：

- 事件持久化：Redis Stream `topic:events:{topicId}`（`MAXLEN ~ 1000`）
- 续传：支持 `Last-Event-ID`
- 过旧：发送 `reload_required`

来源：`docs/api-contract.md` 3.12、`docs/roadmap.md` 0.2（SSE 只推 invalidation）。

## 依赖

- Step 02、Step 06（Redis）、Step 07~Step 10（事件生产者）

## 范围（本 step 做/不做）

- 做：
  - SSE endpoint（从 Redis Stream 读取并推送）
  - `Last-Event-ID` 续传语义
  - `reload_required` 降级
- 不做：
  - 前端 SSE 订阅（Step 15）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（SSE 专项测试清单 + Suite A/C/D/E/F/G 的事件部分）。

建议把 SSE “读取 Redis Stream → 生成 SSE chunk” 抽成纯函数/service，优先做可测单元测试，再补少量集成测试。

- [ ] 当没有 `Last-Event-ID`：从最新开始（或按固定策略，必须文档化）
- [ ] 给定 `Last-Event-ID`：只补发 `(lastId, +inf)` 区间事件
- [ ] `Last-Event-ID` 过旧（已被裁剪）→ 输出 `reload_required` 事件
- [ ] SSE 输出格式符合示例：
  - `id: <redis-stream-id>`
  - `data: {"event":"argument_updated","data":{...}}`
- [ ] HTTP headers：`Content-Type` 为 `text/event-stream; charset=utf-8`（或包含等价 charset）
- [ ] `data:` JSON 必须能被 `shared-contracts` 的 `zSseEnvelope` parse（事件 union 不漂移）
- [ ] 事件只推 invalidation（`id + reason`），不得携带私密数据（例如 ledger/stakes 明细）

### 服务器验收（黑盒）

- [ ] 部署 API：`coolify deploy name <api_app_name>`
- [ ] 连接 SSE：`curl -N -H "Accept: text/event-stream" "$API_BASE_URL/v1/sse/<topicId>"`
- [ ] 触发一次投票/回填后能在 1~数秒内收到事件（可配合 `node scripts/coolify/signed-request.mjs` 发起 `setVotes`/`createArgument`）
- [ ] 断线后携带 `Last-Event-ID` 续传：只收到 lastId 之后的事件
- [ ] 人为制造“Last-Event-ID 过旧”（裁剪/重置 stream）时会收到 `reload_required(reason="trimmed")`

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - SSE controller：设置 `Content-Type: text/event-stream`
  - Redis Stream 读取：
    - 持久化：写路径统一 `XADD topic:events:{topicId} MAXLEN ~ 1000`
    - 续传：`XRANGE (lastId, +]`
  - 过旧判断：`lastId` 不在 stream range 内则发 `reload_required`

## 3) Refactor：模块化与收敛

- [ ] 把事件定义收敛到 `packages/shared-contracts`（API 与 Web 共享 union）
- [ ] 写路径统一封装 `publishTopicEvent(topicId, payload)`（避免到处拼 stream key）

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `curl -N -H "Accept: text/event-stream" "$API_BASE_URL/v1/sse/<topicId>"`
  - 本地快速反馈（可选）：`pnpm -C apps/api test`
- 验收点
  - [ ] 两个浏览器窗口对同一 topic：投票/发言后能秒级收到 invalidation（手动验证）
  - [ ] 断线后携带 `Last-Event-ID` 可续传（手动或集成测试）
