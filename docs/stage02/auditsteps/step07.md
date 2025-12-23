# Audit Step 07 — 签名与防重放审计：canonical message / raw body / nonce / timestamp

## 目标

- 证明签名 v1 的“必须一直成立”：canonical message 完全一致、PATH 口径一致（不含 query）、raw body hash 一致。
- 证明防重放与例外语义一致：除 `setVotes` 强幂等外，nonce 重放一律拒绝；timestamp 窗口固定。

## 输入 / 前置条件

- 基线 commit 已固定。
- 参考口径：
  - `docs/stage01/crypto.md`
  - `docs/stage01/api-contract.md`
  - `PROJECT_REFERENCE.md#6.3`（签名 v1 约束）
- 运行黑盒验证时需要：`API_BASE_URL`。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（代码级，可验证）

核对 canonical message 在前后端的一致性（必须满足）：

- `v1|METHOD|PATH|TIMESTAMP|NONCE|sha256(rawBody)`（无 body 时 hash 为空字符串，末尾保留 `|`）
- `PATH` 不含 query string（前端已对 `path.split("?")[0]`，后端也应等价处理）
- 后端 hash 基于 raw body（不能 re-stringify 对象）
- `X-Nonce` 禁止包含 `|`
- timestamp window：`abs(now - ts) < 60s`
- nonce 去重窗口：60s；`setVotes` 额外强幂等缓存 5 分钟（重放返回相同成功响应）

建议用以下命令把关键点“定位到代码”：

```bash
rg -n "canonical|v1\\|\\$\\{method\\}|path\\.split\\('\\?'\\)|rawBody|TIMESTAMP_WINDOW|checkAndSetNonce|idemp:setVotes" \
  apps/api apps/web packages scripts PROJECT_REFERENCE.md
```

重点文件（本仓库路径）：

- 后端验签：`apps/api/src/common/auth.service.ts`
- 后端 guard：`apps/api/src/common/auth.guard.ts`
- raw body 捕获：`apps/api/src/main.ts`
- 前端签名：`apps/web/lib/signing.ts`
- 前端签名入口：`apps/web/lib/apiClient.ts`
- 黑盒签名脚本：`scripts/coolify/signed-request.mjs`

把审查结论写入：

- `$AUDIT_DIR/signature.code-review.md`

### 2) 黑盒验证（推荐，独立可复现）

> 你可以复用 Step 03 创建的测试 Topic；也可以在本 step 重新创建一个（推荐重新创建，保证独立性）。

#### 2.1 缺失 headers → 必须拒绝

```bash
test -n "${API_BASE_URL:-}" || (echo "Missing API_BASE_URL" && exit 2)
curl -sS -D "$AUDIT_DIR/missing-headers.headers.txt" -o "$AUDIT_DIR/missing-headers.body.txt" \
  -X POST "$API_BASE_URL/v1/topics/00000000-0000-0000-0000-000000000000/commands" \
  -H 'content-type: application/json' \
  -d '{"type":"CLAIM_OWNER","payload":{}}' || true
```

通过标准：

- [ ] 返回 `401`，错误码为 `INVALID_SIGNATURE`（或契约允许的等价错误）。

#### 2.2 nonce 含 `|` → 必须 `400 BAD_REQUEST`（在验签前被拒绝）

> 无需真签名：提供“格式正确但随机”的 pubkey/signature 即可验证 nonce 校验分支。

```bash
NOW="$(node -e 'console.log(Date.now())')"
curl -sS -D "$AUDIT_DIR/bad-nonce.headers.txt" -o "$AUDIT_DIR/bad-nonce.body.txt" \
  -X POST "$API_BASE_URL/v1/topics/00000000-0000-0000-0000-000000000000/commands" \
  -H 'content-type: application/json' \
  -H "X-Pubkey: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
  -H "X-Signature: $(printf 'ab%.0s' {1..64})" \
  -H "X-Timestamp: $NOW" \
  -H "X-Nonce: a|b" \
  -d '{"type":"CLAIM_OWNER","payload":{}}' || true
```

通过标准：

- [ ] 返回 `400` 且错误消息包含 `Nonce cannot contain |`（或等价文案）。

#### 2.3 timestamp 超窗 → 必须 `401 TIMESTAMP_OUT_OF_RANGE`

```bash
export API_BASE_URL
OLD_TS="$(node -e 'console.log(Date.now()-120000)')"
node scripts/coolify/signed-request.mjs \
  GET "/v1/topics/00000000-0000-0000-0000-000000000000/ledger/me" \
  --timestamp "$OLD_TS" \
  | tee "$AUDIT_DIR/timestamp.out-of-range.out" || true
```

通过标准：

- [ ] 返回 `401` 且错误码为 `TIMESTAMP_OUT_OF_RANGE`。

#### 2.4 PATH 口径不一致（签名 PATH ≠ 实际请求 PATH）→ 必须拒绝

```bash
node scripts/coolify/signed-request.mjs \
  GET "/v1/topics/00000000-0000-0000-0000-000000000000/ledger/me" \
  --sign-path "/v1/topics/00000000-0000-0000-0000-000000000000/ledger/meX" \
  | tee "$AUDIT_DIR/sign-path.mismatch.out" || true
```

通过标准：

- [ ] 返回 `401 INVALID_SIGNATURE`（或等价错误）。

## 通过标准（独立可验证）

- [ ] `signature.code-review.md` 覆盖：canonical message、PATH/query、raw body、nonce/timestamp、setVotes 例外。
- [ ] 黑盒证据文件存在（`*.headers.txt`/`*.body.txt`/`*.out`），且状态码/错误码符合预期。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/signature.code-review.md`
- `audit-artifacts/<runId>-<sha>/missing-headers.*`
- `audit-artifacts/<runId>-<sha>/bad-nonce.*`
- `audit-artifacts/<runId>-<sha>/timestamp.out-of-range.out`
- `audit-artifacts/<runId>-<sha>/sign-path.mismatch.out`

