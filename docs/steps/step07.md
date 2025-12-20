# Step 07 — Topic：创建、列表、Host 认领（M2-Topic 最小闭环）

## 目标

按契约跑通：

- `POST /v1/topics`：创建 Topic + Root + claimToken
- `POST /v1/topics/:topicId/commands`：先实现 `CLAIM_OWNER`
- `GET /v1/topics`：列表 cursor 分页（可先最简）

来源：`docs/api-contract.md` 3.1/3.2/3.3，时序见 `docs/core-flows.md#1`。

## 依赖

- Step 02、Step 03、Step 06

## 范围（本 step 做/不做）

- 做：
  - createTopic 事务（Topic + Root Argument 同事务）
  - claimToken（Redis TTL 5~10min）+ CLAIM_OWNER（签名 + token 校验）
  - topics list（先最小口径：createdAt 倒序 + cursor）
- 不做：
  - Host 其他 commands（`SET_STATUS/EDIT_ROOT/PRUNE/UNPRUNE` 放到 Step 21）

## 1) Red：先写测试

### API e2e

- [ ] `POST /v1/topics`：
  - 返回 `topicId/rootArgumentId/claimToken/expiresAt`
  - DB 内存在 Topic 与 Root Argument，且 `topics.root_argument_id` 正确
- [ ] `CLAIM_OWNER`：
  - 需要签名 + `X-Claim-Token`
  - token 正确则写入 `topics.owner_pubkey`
  - token 复用/过期返回 `CLAIM_TOKEN_INVALID/CLAIM_TOKEN_EXPIRED`
- [ ] `GET /v1/topics`：能看到新建 Topic（title 来自 Root）

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - Topic 模块（controller/service/repo）
  - `POST /v1/topics`：生成 UUIDv7（或可替代策略，需与契约一致）并写入 DB
  - claimToken：Redis `SET`（含 TTL）
  - `POST /v1/topics/:topicId/commands`：仅支持 `type=CLAIM_OWNER`
  - `GET /v1/topics`：cursor 分页（可先用 `createdAt/id` 组合 cursor）

## 3) Refactor：模块化与收敛

- [ ] `commands` 做成可扩展的 command handler（为 Step 21 预留）
- [ ] 把 “生成 Root Argument + 同步 topics.title” 固化为 service 内部不变量

## 4) 验收

- 命令
  - `docker compose up -d postgres redis`
  - `pnpm -C apps/api test`
- 验收点
  - [ ] 对照 `docs/api-contract.md`：请求/响应字段完全一致

