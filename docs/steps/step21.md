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

来源：`docs/roadmap.md` M7、`docs/prd.md#2.6`、`docs/api-contract.md` 3.2。

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

### API e2e

- [ ] 非 owner 调用 commands → `403 NOT_TOPIC_OWNER`
- [ ] `PRUNE_ARGUMENT` 后：
  - 公共读 tree/children 不再返回该节点
  - `stakes/me` 仍返回该节点的质押（含 `argumentPrunedAt`）
  - 对该节点 `setVotes` 增票被拒绝（`ARGUMENT_PRUNED_INCREASE_FORBIDDEN`），撤回允许
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

- 验收点
  - [ ] 与 `docs/prd.md`/`docs/architecture.md` 决策清单一致
  - [ ] 资金找回路径成立（pruned 上的 stake 可撤回）

