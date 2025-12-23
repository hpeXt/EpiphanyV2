# Audit Step 02 — 可复现构建：安装/构建/测试/类型检查（不改代码）

## 目标

- 在固定基线下证明：项目可安装、可构建、关键测试可运行，避免后续结论不可复现。
- 把“健康度”最小门槛落实为可执行证据：build/test/typecheck（必要时加 lint，但不能改动代码快照）。

## 输入 / 前置条件

- 基线 commit 已固定（建议工作区干净）。
- 具备：`node`（建议 20+）、`corepack`、`pnpm`、`docker`。
- 若要跑 DB/Redis 相关测试：本机可运行 `docker compose`。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 安装依赖（锁定 lockfile）

```bash
corepack enable
pnpm -v | tee "$AUDIT_DIR/pnpm.version.txt"
pnpm install --frozen-lockfile 2>&1 | tee "$AUDIT_DIR/pnpm.install.log"
```

通过标准：

- [ ] `pnpm install --frozen-lockfile` 退出码为 0。
- [ ] 未出现“自动改写 lockfile”的行为（否则说明基线不可复现）。

### 2) 启动依赖服务（Postgres + Redis）

```bash
docker compose up -d postgres redis
docker compose ps | tee "$AUDIT_DIR/docker.compose.ps.txt"
```

为测试提供最小环境变量（按需调整）：

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/epiphany"
export REDIS_URL="redis://localhost:6379"
```

### 3) 构建（turbo）

```bash
pnpm build 2>&1 | tee "$AUDIT_DIR/pnpm.build.log"
```

### 4) 运行测试（按包，逐个留存日志）

> 注意：不要运行会改代码的命令（例如 `apps/api` 的 `lint` 脚本默认带 `--fix`，会修改文件）。

```bash
pnpm -C packages/shared-contracts test 2>&1 | tee "$AUDIT_DIR/test.shared-contracts.log"
pnpm -C packages/shared-contracts typecheck 2>&1 | tee "$AUDIT_DIR/typecheck.shared-contracts.log"

pnpm -C packages/core-logic test 2>&1 | tee "$AUDIT_DIR/test.core-logic.log"
pnpm -C packages/core-logic typecheck 2>&1 | tee "$AUDIT_DIR/typecheck.core-logic.log"

pnpm -C packages/crypto test 2>&1 | tee "$AUDIT_DIR/test.crypto.log"
pnpm -C packages/crypto typecheck 2>&1 | tee "$AUDIT_DIR/typecheck.crypto.log"

pnpm -C packages/database db:validate 2>&1 | tee "$AUDIT_DIR/db.validate.log"
pnpm -C packages/database test 2>&1 | tee "$AUDIT_DIR/test.database.log"

pnpm -C apps/api test 2>&1 | tee "$AUDIT_DIR/test.api.log"
pnpm -C apps/api test:e2e 2>&1 | tee "$AUDIT_DIR/test.api.e2e.log"

pnpm -C apps/worker test 2>&1 | tee "$AUDIT_DIR/test.worker.log"

pnpm -C apps/web test 2>&1 | tee "$AUDIT_DIR/test.web.log"
pnpm -C apps/web lint 2>&1 | tee "$AUDIT_DIR/lint.web.log"
```

（可选）API 只读 lint（不写文件）：

```bash
pnpm -C apps/api eslint "src/**/*.ts" "test/**/*.ts" 2>&1 | tee "$AUDIT_DIR/lint.api.readonly.log"
```

## 通过标准（独立可验证）

- [ ] `pnpm build` 成功（退出码 0）且日志已保存。
- [ ] 所有测试命令退出码为 0；若某包无测试/需跳过，必须在报告中注明原因与影响范围。
- [ ] 审计过程中未引入对基线的代码改动（`git status --porcelain` 仍为空）。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/pnpm.install.log`
- `audit-artifacts/<runId>-<sha>/pnpm.build.log`
- `audit-artifacts/<runId>-<sha>/test.*.log` / `typecheck.*.log` / `lint.*.log`

