# Audit Step 04 — Secrets 审计：仓库历史扫描与密钥卫生

## 目标

- 覆盖 git 历史的 secrets 扫描，发现硬编码密钥、token、私钥、云凭证等。
- 建立“密钥卫生”清单：`.env.example` 只放占位符；staging/生产密钥可轮换、可吊销。

## 输入 / 前置条件

- 基线 commit 已固定。
- 具备 `git`；建议具备 `docker`（用于运行扫描器，避免本机安装污染）。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 扫描 git 历史（推荐：gitleaks，固定版本）

优先使用 Docker（可复现、无需本机安装）：

```bash
docker run --rm -v "$PWD:/repo" -w /repo \
  zricethezav/gitleaks:v8.18.1 \
  detect --source . --no-git=false \
  --report-format json --report-path "$AUDIT_DIR/gitleaks.report.json" \
  --redact
```

若你已安装 gitleaks，也可：

```bash
gitleaks version | tee "$AUDIT_DIR/gitleaks.version.txt"
gitleaks detect --source . --no-git=false \
  --report-format json --report-path "$AUDIT_DIR/gitleaks.report.json" \
  --redact
```

### 2) 人工复核（避免“只给截图/结论”）

对每条命中逐条记录：

- 是否真实 secrets（真阳性）或误报（假阳性）
- 若为真阳性：泄露范围（历史 commit）、撤销/轮换方式、修复 commit、复测证据

建议把复核结论写入：

- `$AUDIT_DIR/secrets.triage.md`

### 3) `.env*` 与配置文件卫生检查（人工）

核查点：

- [ ] `.env.example` 不包含真实 token/私钥/生产地址。
- [ ] `docker-compose.yml`、`Dockerfile` 不把 `.env` 打进镜像。
- [ ] Worker/AI Provider 相关变量（例如 `OPENROUTER_*`）只在 staging 临时提供且可轮换。

## 通过标准（独立可验证）

- [ ] 存在 `$AUDIT_DIR/gitleaks.report.json`（原始产物，不是截图）。
- [ ] 存在 `$AUDIT_DIR/secrets.triage.md`，且对每条命中给出“真/假阳性 + 处理方式”。
- [ ] 若存在真阳性：已完成吊销/轮换，并在报告中给出复测证据。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/gitleaks.report.json`
- `audit-artifacts/<runId>-<sha>/secrets.triage.md`

