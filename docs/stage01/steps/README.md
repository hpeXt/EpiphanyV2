# Steps（TDD / 小步迭代 / 可验收）

这些 `stepXX.md` 是把 `docs/stage01/roadmap.md` 拆解成 **可独立测试、可独立验收、可小步合并** 的实现步骤（偏工程化执行清单，而不是需求文档）。

约束来源（Single Source of Truth）：

- API 契约：`docs/stage01/api-contract.md`
- DB 语义与不变量：`docs/stage01/database.md`
- 签名与派生：`docs/stage01/crypto.md`
- 端到端流程：`docs/stage01/core-flows.md`
- 架构决策：`docs/stage01/architecture.md`

## 使用方式

- 严格按 step 编号顺序做（后续 step 只依赖已完成的前置 step）。
- 每个 step 都遵循 TDD：**Red（先写测试）→ Green（最小实现）→ Refactor（模块化/消除重复）**。
- 每个 step 的 “验收” 以 **服务器环境可重复跑通 + 自动化测试通过 + 对照契约可验收** 为准（本地仅作为快速反馈）。
- 全量测试规划（Server Acceptance First）见：`docs/stage01/test-plan.md`。
- Coolify 服务器验收运行手册见：`docs/stage01/coolify-acceptance.md`。
- 默认验收环境（context / uuid / URL）见：`docs/stage01/coolify-target.md`（建议先 export 那些环境变量再跑命令）。

## 目录与模块边界（建议）

- `packages/shared-contracts`：Zod schemas / DTO / SSE 事件定义（契约可测试化）
- `packages/database`：Prisma schema + migrations（只放 DB 层）
- `packages/core-logic`：纯业务逻辑（QV 交易计算/不变量），无 DB/框架依赖
- `packages/crypto`：派生/签名/验签/canonical message（Web/API 复用）
- `apps/api`：NestJS（HTTP + SSE + 事务编排 + Redis 幂等/去重）
- `apps/web`：Next.js（视图渲染 + 本地身份/缓存 + SSE 订阅）

## 每个 Step 的 Definition of Done（最小）

- 对应 step 的测试全部通过（单元 + 集成/端到端按 step 要求）
- 对应 step 的验收命令可重复执行（README/脚本/环境变量齐全）
- 不改动未涉及的契约口径（如需改契约，必须先改 `docs/stage01/api-contract.md` 并同步 `shared-contracts` 与测试）
