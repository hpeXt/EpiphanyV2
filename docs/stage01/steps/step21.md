# Step 21 — Host 工具 + 只读语义（M7-治理可用）

## 目标

实现 Host 权限链路与治理语义落地：

- Host 识别：`topicKeypair.pubkey == topic.ownerPubkey`
- commands：
  - `EDIT_ROOT`
  - `SET_STATUS (active/frozen/archived)`
  - `PRUNE_ARGUMENT`
  - `UNPRUNE_ARGUMENT`
- UI 限制：
  - frozen/archived：禁止新增节点/加票；允许撤回
  - pruned：公共读不可见；若已知 id 禁止加票，仅允许减票/撤回

来源：`docs/stage01/roadmap.md` M7、`docs/stage01/prd.md#2.6`、`docs/stage01/api-contract.md` 3.2。

## 依赖

- Step 07、Step 08、Step 10、Step 11、Step 16

## 范围（本 step 做/不做）

- 做：
  - API command handlers + 权限校验（`NOT_TOPIC_OWNER`）
  - 读/写路径统一遵守 status/pruned 限制
  - Web 管理面板最小可用
- 不做：
  - 复杂的 Host 审计日志/理由工作流（可后置）

## 1) Red：先写测试

对照全量规划：`docs/stage01/test-plan.md`（Suite F 的 pruning 找回资金 + 权限/只读语义回归，及 Suite W 的治理 UI）。

### API e2e

- [ ] 非 owner 调用 commands → `403 NOT_TOPIC_OWNER`
- [ ] command payload 校验：
  - 缺少/非法 `type/payload` → `400 BAD_REQUEST`
- [ ] Topic 状态限制（对齐契约）：
  - `active`：允许命令
  - `frozen`：仅允许 `SET_STATUS(active)` 解冻，其它命令 → `409 TOPIC_STATUS_DISALLOWS_WRITE`
  - `archived`：所有命令 → `409 TOPIC_STATUS_DISALLOWS_WRITE`
- [ ] `EDIT_ROOT`：
  - root argument 内容更新
  - `topics.title` 同步更新（列表页缓存口径）
  - SSE：`topic_updated(reason="root_edited")`
- [ ] `SET_STATUS`：
  - 状态更新生效
  - SSE：`topic_updated(reason="status_changed")`
- [ ] `PRUNE_ARGUMENT` 后：
  - 公共读 tree/children 不再返回该节点
  - `stakes/me` 仍返回该节点的质押（含 `argumentPrunedAt`）
  - 对该节点 `setVotes` 增票被拒绝（`ARGUMENT_PRUNED_INCREASE_FORBIDDEN`），撤回允许
  - SSE：`argument_updated(reason="pruned")`
- [ ] `UNPRUNE_ARGUMENT`：
  - 公共读 tree/children 恢复可见
- [ ] `SET_STATUS=frozen/archived` 后：
  - createArgument 被拒绝（`TOPIC_STATUS_DISALLOWS_WRITE`）
  - setVotes 增票被拒绝，但撤回允许

### Web

- [ ] 只有 owner 才看到管理入口
- [ ] frozen/archived/pruned 的 UI 禁用态与后端一致

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - 扩展 `/v1/topics/:topicId/commands` 支持上述 command types
  - 事务更新 topics/arguments
  - 成功后写入 Redis Stream invalidation（`topic_updated` / `argument_updated`）
- `apps/web`：
  - 管理面板（最小：按钮 + 确认弹窗）
  - 根据 topic.status/argument.prunedAt 做禁用态

## 3) Refactor：模块化与收敛

- [ ] 把权限判断（isOwner）与只读规则封装成共享 helper（API/Web 都引用契约枚举）
- [ ] 把“pruned 节点的 visualWeight 视为 0”在渲染层落实（避免幽灵权重）

## 4) 验收

> 前置：先按 `docs/stage01/coolify-target.md` export 环境变量（通用手册：`docs/stage01/coolify-acceptance.md`）。

### 服务器验收（推荐）

```bash
# 部署 API 和 Web
coolify deploy name "$API_APP_NAME" --force
coolify deploy name "$WEB_APP_NAME" --force
coolify app logs "$API_APP_UUID" -n 200
```

手动验收：

- [ ] 用 Host 身份执行命令：
  - `EDIT_ROOT`、`SET_STATUS`、`PRUNE_ARGUMENT`、`UNPRUNE_ARGUMENT`
- [ ] `coolify app logs "$API_APP_UUID" -n 200` 不应出现权限/验签异常
- [ ] tree/children/stakes/me 的对外行为与测试用例一致（可用 `curl` + `scripts/coolify/*.mjs` 验证）

验收点：

- [ ] 与 `docs/stage01/prd.md`/`docs/stage01/architecture.md` 决策清单一致
- [ ] 资金找回路径成立（pruned 上的 stake 可撤回）

### 本地快速反馈（可选）

```bash
docker compose up -d postgres redis
pnpm -C apps/api test
```

验收点：

- [ ] e2e 测试通过
