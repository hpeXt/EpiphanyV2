# Audit Step 12 — Web 审计：XSS/CSP、签名私钥存储、SSE 重连与缓存策略

## 目标

- 验证前端不引入 XSS（尤其是 markdown/富文本/报告渲染），并明确 CSP/安全头责任边界（Next vs 反向代理）。
- 验证签名私钥（master seed）只保存在客户端本地，且不会被日志/上报/请求泄露。
- 验证 SSE 客户端只做 invalidation（不依赖 SSE payload 携带数据），并具备合理的重连/去抖策略。

## 输入 / 前置条件

- 基线 commit 已固定。
- 参考口径：
  - `PROJECT_REFERENCE.md#6.3`（签名 v1）
  - `PROJECT_REFERENCE.md#6.4`（SSE 行为）
- 若跑验证：`pnpm -C apps/web test` / `lint`。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（代码级）

重点核对：

- 签名与 key 存储：
  - `apps/web/lib/signing.ts`（`tm:master-seed:v1` 存储、nonce 生成、canonicalMessageV1）
  - `apps/web/lib/apiClient.ts`（`path.split("?")[0]`，rawBody 传递）
- SSE：
  - `apps/web/components/topics/hooks/useTopicSse.ts`（zod parse、`debounceMs`、`reload_required` 处理）
- XSS 面：
  - 搜索 `dangerouslySetInnerHTML`、非受控 HTML 注入
  - 报告渲染：`apps/web/components/topics/ConsensusReportModal.tsx`（自定义 markdown 解析，确保不执行 HTML）

建议用 ripgrep 保存一次扫描结果（作为证据）：

```bash
rg -n "dangerouslySetInnerHTML|innerHTML|script\\b|<script|eval\\(|Function\\(" apps/web \
  | tee "$AUDIT_DIR/web.xss.search.txt" || true
```

把结论写入：

- `$AUDIT_DIR/web.code-review.md`

### 2) 运行验证（推荐）

```bash
pnpm -C apps/web test 2>&1 | tee "$AUDIT_DIR/test.web.log"
pnpm -C apps/web lint 2>&1 | tee "$AUDIT_DIR/lint.web.log"
```

### 3) CSP/安全头（配置审计）

检查：

- `apps/web/next.config.ts` 是否设置 headers（当前通常需要在反向代理/Coolify 层补齐）
- staging 实际响应是否包含安全头（至少）：`Content-Security-Policy`、`X-Content-Type-Options`、`Referrer-Policy`

黑盒检查（对 `WEB_BASE_URL`）：

```bash
if test -n "${WEB_BASE_URL:-}"; then
  curl -sS -D "$AUDIT_DIR/web.headers.txt" -o /dev/null "$WEB_BASE_URL"
fi
```

## 通过标准（独立可验证）

- [ ] `web.code-review.md` 覆盖：签名逻辑不变量、key 本地存储边界、SSE invalidation、XSS 风险点。
- [ ] `web.xss.search.txt`（或等价搜索结果）可复核。
- [ ] `test.web.log`/`lint.web.log` 成功（或记录失败原因）。
- [ ] 如提供 `WEB_BASE_URL`：`web.headers.txt` 可复核安全头现状与缺口。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/web.code-review.md`
- `audit-artifacts/<runId>-<sha>/web.xss.search.txt`
- `audit-artifacts/<runId>-<sha>/test.web.log`
- `audit-artifacts/<runId>-<sha>/lint.web.log`
- `audit-artifacts/<runId>-<sha>/web.headers.txt`（可选）

