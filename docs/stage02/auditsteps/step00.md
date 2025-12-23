# Audit Step 00 — 审计启动：基线冻结与证据规范

## 目标

- 固定单一审计基线（commit SHA / tag），保证结论可复现。
- 建立统一的证据（artifacts）目录与命名规则，保证每个结论可签收。
- 明确“只用 staging + 自建数据”的边界，避免触碰真实用户数据/生产密钥。

## 输入 / 前置条件

- 仓库代码快照（只读即可）与基线信息（commit SHA / tag）。
- 审计运行环境（本地或独立验收机），具备：`git`、`node`、`pnpm`、`docker`（推荐）。
- 若做黑盒：项目方提供 `API_BASE_URL`（以及可选的 `WEB_BASE_URL`、`WORKER_BASE_URL`），不提供生产权限。

## 操作步骤（可直接复制执行）

### 1) 固定审计基线

```bash
git rev-parse HEAD
git status --porcelain
```

通过标准：

- [ ] `git status --porcelain` 为空（工作区干净）；若不为空，必须把 diff 保存为证据（见下）。

如工作区不干净，保存 diff（仍可继续审计，但报告必须声明偏离基线）：

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
mkdir -p audit-artifacts/manual
git diff > "audit-artifacts/manual/${BASELINE_SHA}.working-tree.diff"
```

### 2) 创建证据目录（本次审计的“收纳箱”）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
AUDIT_DIR="audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}"
mkdir -p "$AUDIT_DIR"
printf '%s\n' "$AUDIT_DIR"
```

### 3) 记录工具版本与环境信息

```bash
{
  echo "baseline_sha=$BASELINE_SHA"
  echo "audit_run_id=$AUDIT_RUN_ID"
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v 2>/dev/null || true)"
  echo "pnpm=$(pnpm -v 2>/dev/null || true)"
  echo "git=$(git --version 2>/dev/null || true)"
  echo "docker=$(docker --version 2>/dev/null || true)"
  echo "docker_compose=$(docker compose version 2>/dev/null || true)"
} | tee "$AUDIT_DIR/env.txt"
```

### 4)（可选）记录审计目标 URL 与边界声明

```bash
{
  echo "API_BASE_URL=${API_BASE_URL:-}"
  echo "WEB_BASE_URL=${WEB_BASE_URL:-}"
  echo "WORKER_BASE_URL=${WORKER_BASE_URL:-}"
  echo ""
  echo "BOUNDARY:"
  echo "- Staging only; no production access."
  echo "- Use self-created test Topics/Arguments only."
  echo "- No real user data; no long-lived secrets."
} | tee "$AUDIT_DIR/target.txt"
```

## 通过标准（本 Step 结束时应能“签收”）

- [ ] `audit-artifacts/<runId>-<sha>/env.txt` 存在且包含基线与工具版本。
- [ ] `audit-artifacts/<runId>-<sha>/target.txt`（若做黑盒）包含目标 URL 与边界声明。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/env.txt`
- `audit-artifacts/<runId>-<sha>/target.txt`（可选）
- `audit-artifacts/manual/<sha>.working-tree.diff`（可选）

## 关联参考

- `docs/stage02/security-audit-plan.md`
- `docs/stage01/api-contract.md`（接口/错误码/签名口径）
- `PROJECT_REFERENCE.md`（稳定不变量与代码定位）

