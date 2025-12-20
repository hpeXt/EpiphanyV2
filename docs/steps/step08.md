# Step 08 — Focus View 读路径：tree + children（M2-公共读可用）

## 目标

实现 Focus View 最小公共读：

- `GET /v1/topics/:topicId/tree?depth=3`
- `GET /v1/arguments/:argumentId/children?orderBy=...&beforeId=...`

并落实 pruning 口径：公共读默认不返回 pruned。

来源：`docs/api-contract.md` 3.4/3.5，规则见 `docs/roadmap.md` 0.2/0.2 pruning。

## 依赖

- Step 02、Step 03、Step 07

## 范围（本 step 做/不做）

- 做：
  - tree depth=3（可用多次查询/递归 CTE，先保证正确）
  - children 排序：`totalVotes_desc | createdAt_desc` + `beforeId/nextBeforeId`
  - pruned 过滤：公共读不返回 pruned
- 不做：
  - 任何写路径（createArgument/setVotes 后续 step）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite C — Flow 2：公共读（tree/children）+ pruning 过滤）。

### API e2e（准备种子数据）

- [ ] tree：
  - depth=1/2/3 行为符合预期（超过 depth 不返回）
  - Root 必定出现
  - pruned 的节点不出现（以及其子树按规则处理：可先“整棵子树不返回”，后续再细化）
  - `404 TOPIC_NOT_FOUND`：topicId 不存在
  - 契约校验：响应能被 `shared-contracts` parse（字段名/类型一致）
  - `authorId`：每个 argument 的 `authorId` 为 16 hex chars（小写）
- [ ] children：
  - `orderBy=totalVotes_desc`：按 `arguments.total_votes` 排序
  - `orderBy=createdAt_desc`：按时间倒序且 `nextBeforeId` 稳定
  - 默认排序：不传 `orderBy` 等价 `totalVotes_desc`
  - limit：默认 `30`，最大 `100`（超过最大值要 clamp 或 `400`，二选一并锁死）
  - pruned 子节点不返回
  - `404 ARGUMENT_NOT_FOUND`：argumentId 不存在
  - 分页：当 children 数量 > limit 时，`nextBeforeId` 不为 null；带 `beforeId` 能取到下一页且不重复
  - `authorId`：每个 child 的 `authorId` 为 16 hex chars（小写）

### Coolify CLI 服务器验收（黑盒）

运行手册：`docs/coolify-acceptance.md`。

- [ ] 部署 API：`coolify deploy name <api_app_name>`
- [ ] tree（公共读）：
  - `curl -fsS "$API_BASE_URL/v1/topics/<topicId>/tree?depth=3"`
- [ ] children（公共读）：
  - `curl -fsS "$API_BASE_URL/v1/arguments/<rootArgumentId>/children?orderBy=createdAt_desc&limit=30"`

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - 查询实现（Repo 层）：`getTopicTree(topicId, depth)`、`getChildren(argumentId, orderBy, beforeId, limit)`
  - 分页字段与 `docs/api-contract.md` 对齐：请求 `beforeId`，响应 `nextBeforeId`

## 3) Refactor：模块化与收敛

- [ ] 把 “过滤 pruned” 做成统一 query helper（避免漏掉）
- [ ] 给 children 查询加复合索引（参考 `docs/database.md#5`）

## 4) 验收

- 命令
  - 服务器验收（推荐）：
    - `coolify deploy name <api_app_name>`
    - `curl -fsS "$API_BASE_URL/v1/topics/<topicId>/tree?depth=3"`
    - `curl -fsS "$API_BASE_URL/v1/arguments/<rootArgumentId>/children?orderBy=createdAt_desc&limit=30"`
  - 本地快速反馈（可选）：`pnpm -C apps/api test`
- 验收点
  - [ ] 公共读接口不需要签名（对齐契约）
  - [ ] pruning 口径成立（pruned 不出现在 tree/children）
