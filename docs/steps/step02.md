# Step 02 — `packages/shared-contracts`：把契约变成可测试代码（M0-契约落地）

## 目标

将 `docs/api-contract.md` 固化成可复用的 Zod schemas / DTO，使 API 与 Web 能在编译期和测试期对齐契约，减少“口径漂移”。

## 依赖

- Step 01

## 范围（本 step 做/不做）

- 做：
  - 新建 `packages/shared-contracts`
  - 覆盖 **错误结构 / 核心 DTO / SSE 事件 envelope**（先覆盖 MVP 需要的最小集，后续 step 继续补齐）
- 不做：
  - 任何业务实现（只做 schema/类型与测试）

## 1) Red：先写测试

建议写“契约样例解析测试”（输入为 `docs/api-contract.md` 中的示例 JSON 或你补齐的 fixture）。

- [ ] `ErrorResponse`：能 parse；`error.code` 只能取允许值
- [ ] `TopicSummary`：能 parse；字段命名/类型与契约一致（camelCase / ISO string）
- [ ] SSE event：能 parse（至少 `topic_updated`、`argument_updated`、`reload_required` 这类基础事件）

建议落点：`packages/shared-contracts/src/__tests__/*.test.ts`

## 2) Green：最小实现（让测试通过）

- 建包：`packages/shared-contracts/package.json` + `tsconfig.json`
- 引入 `zod` 并导出：
  - `zErrorResponse`
  - `zTopicSummary`
  - `zSseEvent`（union + discriminated）
- 对外入口：`packages/shared-contracts/src/index.ts`

## 3) Refactor：模块化与收敛

- [ ] 按 “objects / endpoints / sse / errors” 分文件，避免单文件膨胀
- [ ] 统一导出命名（`zXxx` + `Xxx` 类型）

## 4) 验收

- 命令
  - `pnpm -C packages/shared-contracts test`
  - `pnpm -C apps/api build`（或 `pnpm -C apps/api test`，确保能引用该包）
  - `pnpm -C apps/web build`（确保能引用该包）
- 验收点
  - [ ] schema 测试通过
  - [ ] `apps/api` 与 `apps/web` 都能引用并编译通过

