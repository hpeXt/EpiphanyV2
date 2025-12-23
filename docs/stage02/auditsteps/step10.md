# Audit Step 10 — 风控/限流审计：匿名性边界、IP 哈希、429 语义、幂等不破坏

## 目标

- 证明风控不破坏匿名性边界（不做跨 topic 画像），且 IP 处理为“按 topic 加盐哈希”。
- 证明限流只影响写接口，公共读不受影响；`429 RATE_LIMITED` 语义固定且可复测。
- 证明 `setVotes` 的强幂等重放不会被风控拦截（避免破坏“重放返回一致成功响应”）。

## 输入 / 前置条件

- 基线 commit 已固定。
- 参考口径：
  - `docs/stage01/steps/step23.md`（风控目标）
  - `docs/stage01/api-contract.md`（错误码与 429 结构）
- 黑盒验证需要 `API_BASE_URL`。

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（代码级）

核对点：

- 风控拦截器：`apps/api/src/risk-control/risk-control.interceptor.ts`
  - `options.endpoint === 'setVotes' && req.nonceReplay` 时必须放行（保护强幂等）
- IP 获取策略与规范化：`apps/api/src/risk-control/risk-control.service.ts#getClientIp`
  - 支持 `X-Forwarded-For`/`X-Real-IP`，并做 IPv6-mapped 规范化
- IP 哈希：`hashIp(topicId, ip)` 使用 HMAC-SHA256，且 `RISK_IP_HASH_SALT` 必须在生产环境配置（不能使用默认值）
- 限流 key 设计：
  - pubkey scope：`rl:v1:pk:<endpoint>:<topicId>:<pubkey>`
  - ip scope：`rl:v1:ip:<endpoint>:<topicId>:<ipHash>`

把结论写入：

- `$AUDIT_DIR/risk-control.code-review.md`

### 2) 黑盒验证：公共读不受影响

```bash
test -n "${API_BASE_URL:-}" || (echo "Missing API_BASE_URL" && exit 2)
curl -fsS "$API_BASE_URL/v1/topics?limit=1" | tee "$AUDIT_DIR/public-read.topics.json"
```

通过标准：

- [ ] `GET /v1/topics` 在任何情况下都不应被 `429` 拦截（风控只作用于写接口）。

### 3) 黑盒验证：429 结构与 Retry-After（可选）

> 该项需要你持续触发写接口直到被限流；阈值可通过环境变量调整（或由项目方提供一个低阈值的审计专用环境）。

执行若干次写请求（以 createArgument 或 setVotes 为例），观察是否出现：

- HTTP 429
- `error.code == "RATE_LIMITED"`
- 可选 `Retry-After` 头

将命中的响应头与响应体保存为证据：

```bash
echo "See logs in $AUDIT_DIR (store headers/body when 429 happens)"
```

### 4) 黑盒验证：`setVotes` 重放不被风控阻断

> 关键审计点：本仓库 nonce 去重 TTL 为 60s，但 `setVotes` 幂等缓存 TTL 为 300s。
>
> - 在 `<=60s` 内重放：会被标记为 `nonceReplay`，风控应直接放行（保护强幂等）。
> - 在 `>60s 且 <300s` 内重放：可能不再标记为 `nonceReplay`，若此时风控对 setVotes 限流，可能导致“幂等缓存存在但请求被 429 拦截”，需要明确语义并评估是否为缺陷。

先做一个成功的 setVotes，并立即重放（同 nonce+timestamp）：

```bash
export API_BASE_URL
ARG_ID="<<paste-argumentId>>"

TS="$(node -e 'console.log(Date.now())')"
NONCE="audit-rl-idemp-0001"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":2}' \
  --timestamp "$TS" \
  --nonce "$NONCE" \
  | tee "$AUDIT_DIR/rl.idemp.first.out"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":2}' \
  --timestamp "$TS" \
  --nonce "$NONCE" \
  | tee "$AUDIT_DIR/rl.idemp.replay.within-60s.out"
```

（可选，强烈建议）验证 `>60s 且 <300s` 的重放在“触发限流”时是否仍能拿到缓存响应：

1) 先通过大量 setVotes 触发 `429 RATE_LIMITED`（阈值以实际环境为准）；
2) 等待 65 秒（让 nonce 去重 key 过期，但幂等缓存仍在）；
3) 再次触发 429；
4) 在仍处于限流窗口时重放 `NONCE`，观察是否被 429 拦截（若被拦截，应记录为风险点/缺陷）。

将上述过程的 headers/body（尤其是 429 时）保存为证据。

保存输出到：

- `$AUDIT_DIR/rl.idemp.first.out`
- `$AUDIT_DIR/rl.idemp.replay.within-60s.out`

通过标准：

- [ ] 重放路径不出现 `429`/`403`，而是返回与首次一致的成功响应（幂等保护优先）。

## 通过标准（独立可验证）

- [ ] `risk-control.code-review.md` 明确：匿名性边界、IP 哈希盐、写接口范围、setVotes 幂等放行。
- [ ] `public-read.topics.json` 证明公共读可用。
- [ ] 如触发 429：证据中包含响应头（含 Retry-After）与响应体（含 `RATE_LIMITED`）。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/risk-control.code-review.md`
- `audit-artifacts/<runId>-<sha>/public-read.topics.json`
- `audit-artifacts/<runId>-<sha>/*429*.{headers,body}.txt`（可选）
