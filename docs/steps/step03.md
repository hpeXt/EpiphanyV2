# Step 03 — `packages/database`：Prisma schema + migrations（M1-DB 落稳）

## 目标

按 `docs/database.md` 落地 MVP 所需的数据模型与关键约束：Topic/Argument/Ledger/Stake + 为 AI/聚类预留 camps/cluster_data/consensus_reports。

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
- [ ] 关键约束（至少 2 个）有集成测试覆盖：
  - 每个 Topic 只有一个 Root（`parent_id IS NULL` unique）
  - Stake 的 `cost = votes^2`（DB 层 check 或写入策略保证）

建议落点：`packages/database/src/__tests__/db-constraints.test.ts`（连接到测试库执行）。

## 2) Green：最小实现（让测试通过）

- `packages/database`：
  - Prisma init（`schema.prisma`）
  - 定义 enum：`topic_status`、`argument_analysis_status`、`report_status`（或 Prisma enum 等价物）
  - 定义表（对齐 `docs/database.md` 3.x）：
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

- 前置
  - `docker compose up -d postgres`
  - `DATABASE_URL` 指向本地库
- 命令
  - `pnpm -C packages/database prisma validate`
  - `pnpm -C packages/database prisma migrate deploy`
  - `pnpm -C packages/database test`
- 验收点
  - [ ] migrations 可重复执行（空库/新库）
  - [ ] 约束集成测试通过

