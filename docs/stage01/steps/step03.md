# Step 03 — `packages/database`：Prisma schema + migrations（M1-DB 落稳）

## 目标

按 `docs/stage01/database.md` 落地 MVP 所需的数据模型与关键约束：Topic/Argument/Ledger/Stake + 为 AI/聚类预留 camps/cluster_data/consensus_reports。

## 依赖

- Step 01

## 范围（本 step 做/不做）

- 做：
  - 新建 `packages/database`（Prisma）
  - Prisma schema + migrations 可在空库运行成功
  - pgvector 扩展（embedding 维度固定 4096）
- 不做：
  - API 读写接口（后续 step 做）
  - AI 逻辑实现（只建表）

## 1) Red：先写测试

以 “schema 验证 + 迁移可运行 + 关键约束能挡住坏数据” 为测试目标：

- [ ] `prisma validate` 通过
- [ ] `prisma migrate dev`/`prisma migrate deploy` 在空库成功
- [ ] 关键约束（建议 ≥ 5 个）有集成测试覆盖（直接插入“坏数据”应失败）：
  - 每个 Topic 只有一个 Root（`parent_id IS NULL` unique）
  - 父子同 Topic：`parent_id` 必须指向同一 `topic_id` 下的 argument（见 `docs/stage01/database.md` 3.2 建议）
  - `ledgers` 唯一键：`(topic_id, pubkey)` 不能重复
  - `stakes` 唯一键：`(topic_id, argument_id, voter_pubkey)` 不能重复
  - Stake `votes` 范围与 `cost = votes^2`（若 DB 层有 check，则必须覆盖；若改为“写入策略保证”，也要测策略）
  - （可选）pgvector：`vector` extension 已安装，且 embedding 维度固定为 4096（插入错误维度应失败）

建议落点：`packages/database/src/__tests__/db-constraints.test.ts`（连接到测试库执行，推荐使用独立的 `DATABASE_URL_TEST`）。

## 2) Green：最小实现（让测试通过）

- `packages/database`：
  - Prisma init（`schema.prisma`）
  - 定义 enum：`topic_status`、`argument_analysis_status`、`report_status`（或 Prisma enum 等价物）
  - 定义表（对齐 `docs/stage01/database.md` 3.x）：
    - `topics`
    - `arguments`
    - `ledgers`
    - `stakes`
    - `camps`
    - `cluster_data`
    - `consensus_reports`
  - migration：包含 `CREATE EXTENSION IF NOT EXISTS vector;`

## 3) Refactor：模块化与收敛

- [ ] 明确 DB package 的职责：只放 Prisma schema/migrations/client，避免混入业务逻辑
- [ ] 为 API/Worker 复用提供统一的 Prisma Client 导出（例如 `packages/database` 暴露 `getPrisma()`）

## 4) 验收

> 前置：先按 `docs/stage01/coolify-target.md` export 环境变量（通用手册：`docs/stage01/coolify-acceptance.md`）。

### 服务器验收（推荐）

目的：确保验收机上的 DB 可用、migrations 已应用、API 能正常读写。

```bash
# 确认 Postgres 处于可用状态
coolify database get "$POSTGRES_UUID"

# 部署 API（启动时应完成 migrations 或至少不报错）
coolify deploy name "$API_APP_NAME" --force
coolify app deployments logs "$API_APP_UUID" --format pretty

# 最小写入验证
curl -fsS -X POST "$API_BASE_URL/v1/topics" \
  -H 'Content-Type: application/json' \
  -d '{"title":"E2E::db","body":"seed"}'
```

验收点：

- [ ] Postgres 处于可用状态
- [ ] 部署日志不应出现 migrate 失败
- [ ] 最小写入验证成功

### 本地快速反馈（可选）

```bash
docker compose up -d postgres
pnpm -C packages/database prisma validate
pnpm -C packages/database prisma migrate deploy
pnpm -C packages/database test
```

验收点：

- [ ] migrations 可重复执行（空库/新库）
- [ ] 约束集成测试通过
