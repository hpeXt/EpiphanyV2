# Step 07 — Topic：创建、列表、Host 认领（M2-Topic 最小闭环）

## 目标

按契约跑通：

- `POST /v1/topics`：创建 Topic + Root + claimToken
- `POST /v1/topics/:topicId/commands`：先实现 `CLAIM_OWNER`
- `GET /v1/topics`：列表 `beforeId` 分页（cursor，见契约字段）

来源：`docs/api-contract.md` 3.1/3.2/3.3，时序见 `docs/core-flows.md#1`。

## 依赖

- Step 02、Step 03、Step 06

## 范围（本 step 做/不做）

- 做：
  - createTopic 事务（Topic + Root Argument 同事务）
  - claimToken（Redis TTL 5~10min）+ CLAIM_OWNER（签名 + token 校验）
  - topics list（先最小口径：`orderBy=createdAt_desc` + `beforeId/nextBeforeId`）
- 不做：
  - Host 其他 commands（`SET_STATUS/EDIT_ROOT/PRUNE/UNPRUNE` 放到 Step 21）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite B — Flow 1：创建 Topic + Host 认领）。

### API e2e

- [ ] `POST /v1/topics`：
  - 返回 `topicId/rootArgumentId/claimToken/expiresAt`
  - DB 内存在 Topic 与 Root Argument，且 `topics.root_argument_id` 正确
  - 缺少 `title/body` 或空字符串 → `400 BAD_REQUEST`
  - `expiresAt` 为 ISO 且在未来（> now）
- [ ] `CLAIM_OWNER`：
  - 需要签名 + `X-Claim-Token`
  - token 正确则写入 `topics.owner_pubkey`
  - token 复用返回 `400 CLAIM_TOKEN_INVALID`
  - token 过期返回 `400 CLAIM_TOKEN_EXPIRED`
  - 成功后 token 被消费（再次 claim 必须失败）
  - （推荐）成功后写入 SSE invalidation：`topic_updated(reason="owner_claimed")`（写入 Redis Stream，SSE endpoint 在 Step 12）
- [ ] `GET /v1/topics`：
  - 能看到新建 Topic（title 来自 Root）
  - 分页口径：使用 `beforeId` 请求下一页，响应 `nextBeforeId` 稳定且不重复
  - limit：默认 `20`，最大 `100`（超过最大值要 clamp 或 `400`，二选一并锁死）

### Coolify CLI 服务器验收（黑盒）

运行手册：`docs/coolify-acceptance.md`。

- [ ] 部署 API：`coolify deploy name <api_app_name>`；确认 API 正常启动（`coolify app logs <api_app_uuid> -n 200`）
- [ ] 创建 Topic（不签名）：
  - `curl -fsS -X POST "$API_BASE_URL/v1/topics" -H 'Content-Type: application/json' -d '{"title":"E2E::topic","body":"root"}'`
- [ ] CLAIM_OWNER（签名 + claimToken）：
  - `node scripts/coolify/signed-request.mjs POST /v1/topics/<topicId>/commands '{"type":"CLAIM_OWNER","payload":{}}' --extra-header "X-Claim-Token: <claimToken>"`
- [ ] 列表可见：`curl -fsS "$API_BASE_URL/v1/topics?limit=20"`

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - Topic 模块（controller/service/repo）
  - `POST /v1/topics`：生成 UUIDv7（或可替代策略，需与契约一致）并写入 DB
  - claimToken：Redis `SET`（含 TTL）
  - `POST /v1/topics/:topicId/commands`：仅支持 `type=CLAIM_OWNER`
  - `GET /v1/topics`：按契约使用 `beforeId/nextBeforeId` 分页（UUID v7 cursor）

## 3) Refactor：模块化与收敛

- [ ] `commands` 做成可扩展的 command handler（为 Step 21 预留）
- [ ] 把 “生成 Root Argument + 同步 topics.title” 固化为 service 内部不变量

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `curl -fsS -X POST "$API_BASE_URL/v1/topics" -H 'Content-Type: application/json' -d '{"title":"E2E::topic","body":"root"}'`
    - `node scripts/coolify/signed-request.mjs POST /v1/topics/<topicId>/commands '{"type":"CLAIM_OWNER","payload":{}}' --extra-header "X-Claim-Token: <claimToken>"`
  - 本地快速反馈（可选）：
    - `docker compose up -d postgres redis`
    - `pnpm -C apps/api test`
- 验收点
  - [ ] 对照 `docs/api-contract.md`：请求/响应字段完全一致
