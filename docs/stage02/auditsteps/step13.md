# Audit Step 13 — 数据库与迁移审计：schema 约束、索引、pgvector、权限最小化

## 目标

- 验证 DB schema 与迁移可复现；关键约束尽可能在 DB 层锁死（避免仅靠应用层）。
- 审计 pgvector 使用与数据规模风险；审计权限与网络暴露（DB/Redis 不应对公网开放）。

## 输入 / 前置条件

- 基线 commit 已固定。
- 若跑验证：具备 `DATABASE_URL`、`docker`（推荐）。
- 参考文档：
  - `docs/stage01/database.md`
  - `packages/database/prisma/schema.prisma`

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（schema 级）

核对点（写入 `$AUDIT_DIR/db.schema-review.md`）：

- 主键/外键/唯一约束是否覆盖核心关系（Topic/Argument/Ledger/Stake）。
- 是否存在能在 DB 层表达的关键 check 约束（例如 votes 范围、cost 非负、以及资金不变量的可行性评估）。
- 是否存在必要索引（topicId、parentId、totalVotes/createdAt 排序字段）。
- pgvector：
  - embedding 维度是否固定（4096）
  - 写入路径是否参数化（避免 SQL 注入）

### 2) Prisma validate + generate（可执行验证）

```bash
pnpm -C packages/database db:validate 2>&1 | tee "$AUDIT_DIR/db.validate.log"
pnpm -C packages/database db:generate 2>&1 | tee "$AUDIT_DIR/db.generate.log"
```

### 3) 迁移可复现性（可选但建议）

在空库上执行迁移并验证关键表存在（建议在专用测试库/容器中完成）。

最小方式（本仓库 docker compose）：

```bash
docker compose up -d postgres
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/epiphany"
pnpm -C packages/database prisma migrate deploy 2>&1 | tee "$AUDIT_DIR/db.migrate.deploy.log"
```

## 通过标准（独立可验证）

- [ ] `db.schema-review.md` 明确：约束缺口、索引缺口、pgvector 风险点与建议。
- [ ] `db.validate.log` / `db.generate.log` 成功。
- [ ] 如执行迁移：`db.migrate.deploy.log` 成功，且数据库具备关键表。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/db.schema-review.md`
- `audit-artifacts/<runId>-<sha>/db.validate.log`
- `audit-artifacts/<runId>-<sha>/db.generate.log`
- `audit-artifacts/<runId>-<sha>/db.migrate.deploy.log`（可选）

