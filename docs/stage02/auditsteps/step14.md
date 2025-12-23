# Audit Step 14 — 部署/运行时审计：Docker/Compose/Coolify/网络暴露/安全头

## 目标

- 审计部署形态是否符合最小权限：非 root、最小暴露端口、密钥不入镜像、DB/Redis 不对公网暴露。
- 审计运行时安全基线：CORS、安全头、日志与追踪不泄密、可用的健康检查。

## 输入 / 前置条件

- 基线 commit 已固定。
- 参考文件：
  - `Dockerfile`、`apps/api/Dockerfile`、`apps/web/Dockerfile`
  - `docker-compose.yml`
  - `docs/stage01/deploy-coolify.md`、`docs/stage01/coolify-acceptance.md`

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（Docker/Compose）

核对点（写入 `$AUDIT_DIR/runtime.deploy-review.md`）：

- 镜像是否以非 root 运行（本仓库 Dockerfile 已使用 `adduser` + `USER`，需确认无回退）。
- 是否把 `.env` 或 secrets COPY 进镜像（禁止）。
- `docker-compose.yml` 是否把 Postgres/Redis 绑定到公网（生产必须关闭；本地可接受）。
- API CORS 策略：
  - `apps/api/src/main.ts`：生产环境是否强制配置 `CORS_ORIGIN`；是否避免 `*` + credentials。
- Web 安全头/CSP 是否由反向代理补齐（Next 默认未设置）。

### 2) 运行构建（可选）

```bash
docker build -t epiphany-audit-api -f apps/api/Dockerfile . 2>&1 | tee "$AUDIT_DIR/docker.build.api.log"
docker build -t epiphany-audit-web -f apps/web/Dockerfile . 2>&1 | tee "$AUDIT_DIR/docker.build.web.log"
```

### 3) 镜像/文件系统扫描（可选但建议：Trivy）

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.56.2 image --format json -o "$AUDIT_DIR/trivy.api.json" epiphany-audit-api || true
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.56.2 image --format json -o "$AUDIT_DIR/trivy.web.json" epiphany-audit-web || true
```

## 通过标准（独立可验证）

- [ ] `runtime.deploy-review.md` 明确：端口暴露、密钥管理、非 root、CORS/安全头缺口与建议。
- [ ] 如执行构建：`docker.build.*.log` 成功。
- [ ] 如执行扫描：`trivy.*.json` 作为原始产物存在，并对 Critical/High 给出处理建议。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/runtime.deploy-review.md`
- `audit-artifacts/<runId>-<sha>/docker.build.api.log`（可选）
- `audit-artifacts/<runId>-<sha>/docker.build.web.log`（可选）
- `audit-artifacts/<runId>-<sha>/trivy.api.json`（可选）
- `audit-artifacts/<runId>-<sha>/trivy.web.json`（可选）

