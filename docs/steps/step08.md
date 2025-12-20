# Step 08 — Focus View 读路径：tree + children（M2-公共读可用）

## 目标

实现 Focus View 最小公共读：

- `GET /v1/topics/:topicId/tree?depth=3`
- `GET /v1/arguments/:argumentId/children?orderBy=...&cursor=...`

并落实 pruning 口径：公共读默认不返回 pruned。

来源：`docs/api-contract.md` 3.4/3.5，规则见 `docs/roadmap.md` 0.2/0.2 pruning。

## 依赖

- Step 02、Step 03、Step 07

## 范围（本 step 做/不做）

- 做：
  - tree depth=3（可用多次查询/递归 CTE，先保证正确）
  - children 排序：`totalVotes_desc | createdAt_desc` + cursor
  - pruned 过滤：公共读不返回 pruned
- 不做：
  - 任何写路径（createArgument/setVotes 后续 step）

## 1) Red：先写测试

### API e2e（准备种子数据）

- [ ] tree：
  - depth=1/2/3 行为符合预期（超过 depth 不返回）
  - Root 必定出现
  - pruned 的节点不出现（以及其子树按规则处理：可先“整棵子树不返回”，后续再细化）
- [ ] children：
  - `orderBy=totalVotes_desc`：按 `arguments.total_votes` 排序
  - `orderBy=createdAt_desc`：按时间倒序且 cursor 稳定
  - pruned 子节点不返回

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - 查询实现（Repo 层）：`getTopicTree(topicId, depth)`、`getChildren(argumentId, orderBy, cursor)`
  - cursor 结构与 `docs/api-contract.md` 对齐（字段名/分页口径固定）

## 3) Refactor：模块化与收敛

- [ ] 把 “过滤 pruned” 做成统一 query helper（避免漏掉）
- [ ] 给 children 查询加复合索引（参考 `docs/database.md#5`）

## 4) 验收

- 命令
  - `pnpm -C apps/api test`
- 验收点
  - [ ] 公共读接口不需要签名（对齐契约）
  - [ ] pruning 口径成立（pruned 不出现在 tree/children）

