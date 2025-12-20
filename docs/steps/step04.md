# Step 04 — `packages/core-logic`：QV `setVotes` 纯逻辑（M1-不变量）

## 目标

把 QV 核心交易计算抽成无框架、无 DB 依赖的纯函数，并用单测锁死不变量（后续 API 只做“编排 + 事务”）。

来源：`docs/architecture.md` 5.3、`docs/database.md` 6.3、`docs/api-contract.md` 3.7。

## 依赖

- Step 02（可选：复用错误码/DTO）

## 范围（本 step 做/不做）

- 做：
  - `setVotes` 的 delta 计算与校验（votes/cost/balance 不变量）
  - 边界：`targetVotes` 0..10、余额不足、撤回/减票
- 不做：
  - 任何 DB 事务与锁（留给 API）
  - SSE/幂等缓存（留给 API）

## 1) Red：先写测试

最少覆盖这些 case（建议表驱动）：

- [ ] `currentVotes=0 -> targetVotes=0`：deltaCost=0
- [ ] `currentVotes=5 -> targetVotes=5`：deltaVotes=0 且 deltaCost=0（幂等输入）
- [ ] `0 -> 10`：deltaCost=100（全额消耗）
- [ ] `10 -> 0`：deltaCost=-100（全额返还）
- [ ] `3 -> 4`：deltaCost = 16-9 = 7
- [ ] 余额不足时拒绝（返回可映射为 `INSUFFICIENT_BALANCE`）
- [ ] `targetVotes` 非整数或越界拒绝
- [ ] “只允许减少”的限制可表达（用于 pruned/frozen：`targetVotes <= currentVotes`）
- [ ] 不变量：`balance + totalCostStaked == 100` 始终成立（用多组输入验证）

建议补充（提升鲁棒性）：

- [ ] 对称性：`deltaCost(a->b) === -deltaCost(b->a)`（同一对 votes）
- [ ] 随机序列：从 balance=100 开始随机执行多次 setVotes（含撤回），每步不变量都成立（可用表驱动或 property-based）
- [ ] 只用整数：所有输出都为整数（避免引入浮点）

### Coolify CLI 服务器验收（黑盒）

> 该 step 本身是纯逻辑；在验收机上主要验证“构建可用 + 后续写路径回归不破坏”。

- [ ] 部署 API：`coolify deploy name <api_app_name>`（确保 `packages/core-logic` 的变更不会导致构建/启动失败）
- [ ] （回归，需 Step 10 已完成）执行一次 `setVotes` 黑盒用例并确认资金守恒（见 `docs/test-plan.md` Suite E）

建议落点：`packages/core-logic/src/__tests__/setVotes.test.ts`

## 2) Green：最小实现（让测试通过）

- 暴露纯函数（示例命名，按实际代码风格定）：
  - `calculateVoteCost(votes: number): number`（`votes^2`）
  - `calculateSetVotesDelta(args): { deltaVotes; deltaCost }`
  - `validateSetVotes(args): Result<...>`（把“只允许减少”等策略做成可选参数）

## 3) Refactor：模块化与收敛

- [ ] 让 API 能把不同写路径（createArgument initialVotes / setVotes）复用同一套计算与校验
- [ ] 错误映射：保持与 `docs/api-contract.md` 的 `error.code` 一致（可通过 shared-contracts 常量化）

## 4) 验收

- 命令
  - 服务器验收（推荐）：`coolify deploy name <api_app_name>`
  - 本地快速反馈（可选）：`pnpm -C packages/core-logic test`
- 验收点
  - [ ] 单测覆盖核心边界与不变量
  - [ ] 无 DB/框架依赖（可在 Node 环境直接跑）
