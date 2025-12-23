# Audit Step 06 — SAST 审计：Semgrep/CodeQL（规则版本锁定 + 原始产物）

## 目标

- 通过 SAST 覆盖常见高危类：注入、路径拼接、SSRF、XSS、鉴权缺陷、敏感信息日志等。
- 输出可复测的原始产物（SARIF/JSON），并固定规则版本（避免“同一结论不可复现”）。

## 输入 / 前置条件

- 基线 commit 已固定。
- 建议已完成 `pnpm install`（让 SAST 能解析依赖与类型信息）。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) Semgrep（推荐：Docker 固定版本，产出 SARIF）

```bash
docker run --rm -v "$PWD:/repo" -w /repo \
  returntocorp/semgrep:1.103.0 \
  semgrep scan \
    --config p/javascript \
    --config p/typescript \
    --config p/nodejs \
    --sarif --output "$AUDIT_DIR/semgrep.sarif" \
    --metrics=off
```

（可选）额外关注点：`express`/`nestjs`、反序列化、header 信任链、日志泄密。

### 2) CodeQL（若在 GitHub/GitLab 等平台，可用官方 pipeline）

若审计在代码托管平台进行，优先用 CodeQL code scanning 并下载 SARIF 作为证据：

- [ ] 记录：CodeQL 版本、语言包版本、查询套件（query suite）版本。
- [ ] 保存：SARIF 原始产物到 `$AUDIT_DIR/codeql.sarif`。

## 结果分流（必须做）

对每条 High/Critical：

- [ ] 给出最小复现（代码位置、触发条件）。
- [ ] 判断真/假阳性并记录理由。
- [ ] 若为真阳性：给出修复建议与复测方法（最好加测试/脚本）。

建议输出：

- `$AUDIT_DIR/sast.triage.md`

## 通过标准（独立可验证）

- [ ] `semgrep.sarif`（以及可选 `codeql.sarif`）存在且可被工具重新打开。
- [ ] `sast.triage.md` 覆盖所有 High/Critical，并注明结论与复测计划。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/semgrep.sarif`
- `audit-artifacts/<runId>-<sha>/codeql.sarif`（可选）
- `audit-artifacts/<runId>-<sha>/sast.triage.md`

