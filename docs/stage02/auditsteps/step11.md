# Audit Step 11 — Worker 审计：队列幂等、外部调用、数据外传与日志泄密

## 目标

- 证明 Worker 处理链路安全且可控：任务幂等、重试策略、写回一致性、不泄密日志。
- 明确外部 AI Provider（当前多为 mock/占位）未来接入的安全边界：超时、最小权限、数据外传控制、prompt 注入风险。

## 输入 / 前置条件

- 基线 commit 已固定。
- 参考文档：
  - `docs/stage01/ai-worker.md`
  - `docs/stage01/test-plan.md`（AI 默认 mock）
- 若做运行验证：具备 `REDIS_URL`、`DATABASE_URL`，并能运行 `pnpm -C apps/worker test`。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（代码级）

核对点（按高风险优先）：

- 入口与健康检查：`apps/worker/src/main.ts`
  - `GET /health` 是否只暴露最小信息
  - Redis/DB ping 的失败路径是否安全（不泄露连接串/凭证）
- Job 幂等：
  - argument-analysis：`apps/worker/src/processors/argument-analysis.ts`（ready short-circuit）
  - topic-cluster / consensus-report：对应 processors（避免重复写入/重复触发）
- 外部调用策略：
  - Provider 工厂：`apps/worker/src/providers/provider-factory.ts`
  - 明确：真实 provider（如 OpenRouter）接入时必须加超时、重试上限、熔断、最小字段出站
- 日志泄密检查：
  - 禁止打印：prompt、用户私密数据、tokens、完整请求体

把结论写入：

- `$AUDIT_DIR/worker.code-review.md`

### 2) 运行验证（推荐：跑测试）

```bash
pnpm -C apps/worker test 2>&1 | tee "$AUDIT_DIR/test.worker.log"
```

（可选）健康检查（staging/本地）：

```bash
if test -n "${WORKER_BASE_URL:-}"; then
  curl -fsS "$WORKER_BASE_URL/health" | tee "$AUDIT_DIR/worker.health.json"
fi
```

## 通过标准（独立可验证）

- [ ] `worker.code-review.md` 覆盖：幂等、外部调用边界、日志泄密、健康检查暴露面。
- [ ] `test.worker.log` 退出码为 0（或明确记录失败原因与影响）。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/worker.code-review.md`
- `audit-artifacts/<runId>-<sha>/test.worker.log`
- `audit-artifacts/<runId>-<sha>/worker.health.json`（可选）

