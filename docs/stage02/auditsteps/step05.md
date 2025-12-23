# Audit Step 05 — 依赖/许可证审计：SCA + SBOM + License

## 目标

- 发现第三方依赖中的已知漏洞（含传递依赖），并输出可复测的原始报告。
- 生成 SBOM（CycloneDX 或等价），并做许可证风险筛查。

## 输入 / 前置条件

- 基线 commit 已固定；建议已执行 `pnpm install --frozen-lockfile`。
- 具备网络访问（拉取漏洞数据库/镜像），或使用离线镜像缓存。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) `pnpm audit`（输出原始 JSON）

```bash
pnpm audit --json 2>&1 | tee "$AUDIT_DIR/pnpm.audit.json"
```

### 2) OSV 扫描（推荐：Docker 固定版本）

```bash
docker run --rm -v "$PWD:/repo" -w /repo \
  ghcr.io/google/osv-scanner:v1.9.2 \
  --lockfile=pnpm-lock.yaml \
  --format=json \
  --output="$AUDIT_DIR/osv.report.json"
```

### 3) 生成 SBOM（建议：cdxgen）

> `cdxgen` 对 monorepo/多 lockfile 场景容错更好；产物建议用 CycloneDX JSON。

```bash
pnpm dlx @appthreat/cdxgen@11.5.6 -t nodejs -o "$AUDIT_DIR/sbom.cdx.json"
```

（如审计机不允许 `pnpm dlx`，可用 Docker 版本）：

```bash
docker run --rm -v "$PWD:/repo" -w /repo \
  ghcr.io/appthreat/cdxgen:v11.5.6 \
  -t nodejs -o "$AUDIT_DIR/sbom.cdx.json"
```

### 4) License 检查（最小可落地）

```bash
pnpm dlx license-checker-rseidelsohn@4.4.2 --json --out "$AUDIT_DIR/licenses.json"
```

## 通过标准（独立可验证）

- [ ] `pnpm.audit.json`、`osv.report.json`、`sbom.cdx.json`、`licenses.json` 均已生成并可复查。
- [ ] 对 Critical/High 漏洞逐条给出：受影响包、可利用性、升级/缓解建议、修复与复测证据。
- [ ] 对高风险许可证（例如 GPL/AGPL 等）给出：影响范围与处置建议（替换/隔离/接受风险）。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/pnpm.audit.json`
- `audit-artifacts/<runId>-<sha>/osv.report.json`
- `audit-artifacts/<runId>-<sha>/sbom.cdx.json`
- `audit-artifacts/<runId>-<sha>/licenses.json`

