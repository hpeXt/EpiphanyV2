# Step 02 — `packages/shared-contracts`：把契约变成可测试代码（M0-契约落地）

## 目标

将 `docs/stage01/api-contract.md` 固化成可复用的 Zod schemas / DTO，使 API 与 Web 能在编译期和测试期对齐契约，减少“口径漂移”。

## 依赖

- Step 01

## 范围（本 step 做/不做）

- 做：
  - 新建 `packages/shared-contracts`
  - 覆盖 **错误结构 / 核心 DTO / SSE 事件 envelope**（先覆盖 MVP 需要的最小集，后续 step 继续补齐）
- 不做：
  - 任何业务实现（只做 schema/类型与测试）

## 1) Red：先写测试

建议写“契约样例解析测试”（输入为 `docs/stage01/api-contract.md` 中的示例 JSON 或你补齐的 fixture）。

- [ ] `ErrorResponse`：能 parse；`error.code` 只能取允许值（见 `docs/stage01/api-contract.md#2.2`）
- [ ] `TopicSummary`：能 parse；字段命名/类型与契约一致（camelCase / ISO string）
- [ ] `Argument`：能 parse；包含 `authorId`（16 hex chars，小写）且 `analysisStatus/stanceScore` 语义正确
- [ ] `LedgerMe` / `StakeMeItem`：能 parse；数值字段为整数语义（测试用例用整数字面量）
- [ ] SSE `SseEnvelope`：能 parse（覆盖全部 union 分支）
  - `argument_updated.reason ∈ {"new_vote","analysis_done","edited","pruned"}`
  - `topic_updated.reason ∈ {"status_changed","owner_claimed","root_edited"}`
  - `reload_required.reason === "trimmed"`

### 端点样例（推荐覆盖，防止漂移）

把 `docs/stage01/api-contract.md#3.x` 的示例响应落成 fixture，并在测试里逐个 parse：

- [ ] `POST /v1/topics` 响应（含 `claimToken/expiresAt`）
- [ ] `GET /v1/topics` 响应（含 `nextBeforeId`）
- [ ] `GET /v1/topics/:topicId/tree` 响应（含 `topic/depth/arguments`）
- [ ] `GET /v1/arguments/:argumentId/children` 响应（含 `items/nextBeforeId`）
- [ ] `POST /v1/topics/:topicId/arguments` 响应（`argument` + `ledger`）
- [ ] `POST /v1/arguments/:argumentId/votes` 响应（delta + `ledger`）
- [ ] `GET /v1/topics/:topicId/ledger/me` 响应
- [ ] `GET /v1/topics/:topicId/stakes/me` 响应
- [ ] `POST /v1/user/batch-balance` 响应（results[] ok/failed 混合）
- [ ] `GET /v1/topics/:topicId/cluster-map` 响应（坐标范围与 `clusterId` 口径）

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

> 前置：先按 `docs/stage01/coolify-target.md` export 环境变量（通用手册：`docs/stage01/coolify-acceptance.md`）。

### 服务器验收（推荐）

目的：保证 shared-contracts 的变更不会导致 API/Web 在验收机上构建失败或运行时契约漂移。

```bash
# 部署 API（确认部署日志无 TS/Zod 相关报错）
coolify deploy name "$API_APP_NAME" --force
coolify app deployments logs "$API_APP_UUID" --format pretty

# 部署 Web（确认部署日志无 TS/Zod 相关报错）
coolify deploy name "$WEB_APP_NAME" --force
coolify app deployments logs "$WEB_APP_UUID" --format pretty

# API 对外可用（至少不应 5xx）
curl -fsS "$API_BASE_URL/v1/topics?limit=1"
```

验收点：

- [ ] 部署日志无 TS/Zod 相关报错
- [ ] API 对外可用：`curl -fsS "$API_BASE_URL/v1/topics?limit=1"` 不应 5xx

### 本地快速反馈（可选）

```bash
pnpm -C packages/shared-contracts test
pnpm -C apps/api build   # 确保能引用该包
pnpm -C apps/web build   # 确保能引用该包
```

验收点：

- [ ] schema 测试通过
- [ ] `apps/api` 与 `apps/web` 都能引用并编译通过
