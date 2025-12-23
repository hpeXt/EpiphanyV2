# Audit Step 03 — 黑盒冒烟：staging 最小闭环（含 SSE）

## 目标

- 用黑盒方式证明：API/Worker 可达、关键端点可用、SSE 可建立连接并产出事件。
- 以“最小可验证闭环”覆盖：创建 Topic → 认领 owner → 创建 Argument → setVotes → SSE invalidation。

## 输入 / 前置条件

- 已获得 staging 的对外地址（不需要 token）：
  - `API_BASE_URL`（必需）
  - `WORKER_BASE_URL`（可选，但建议有）
- 本 step 会创建新的测试 Topic/Argument（不触碰真实数据）。
- 需要 Node（用于运行签名脚本）：`node scripts/coolify/signed-request.mjs ...`

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 基础健康检查

```bash
test -n "${API_BASE_URL:-}" || (echo "Missing API_BASE_URL" && exit 2)
curl -fsS "$API_BASE_URL/health" | tee "$AUDIT_DIR/api.health.json"
```

（可选）Worker health：

```bash
if test -n "${WORKER_BASE_URL:-}"; then
  curl -fsS "$WORKER_BASE_URL/health" | tee "$AUDIT_DIR/worker.health.json"
fi
```

### 2) 创建 Topic（不签名）

```bash
TOPIC_CREATE_RES="$AUDIT_DIR/topic.create.json"
curl -fsS -X POST "$API_BASE_URL/v1/topics" \
  -H 'content-type: application/json; charset=utf-8' \
  -d '{"title":"AUDIT::SMOKE","body":"smoke test topic (staging only)"}' \
  | tee "$TOPIC_CREATE_RES"
```

提取 `topicId/rootArgumentId/claimToken`（不依赖 `jq`）：

```bash
TOPIC_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).topicId)" "$TOPIC_CREATE_RES")"
ROOT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).rootArgumentId)" "$TOPIC_CREATE_RES")"
CLAIM_TOKEN="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).claimToken)" "$TOPIC_CREATE_RES")"
printf '%s\n' "TOPIC_ID=$TOPIC_ID" "ROOT_ID=$ROOT_ID" | tee "$AUDIT_DIR/topic.ids.txt"
```

### 3) 建立 SSE（手动停止即可，日志作为证据）

打开一个新终端执行（收到至少 1 条 `data:` 后可 Ctrl-C）：

```bash
curl -N -H 'Accept: text/event-stream' "$API_BASE_URL/v1/sse/$TOPIC_ID" \
  | tee "$AUDIT_DIR/sse.stream.log"
```

通过标准（SSE）：

- [ ] `sse.stream.log` 中存在 `data: { ... }` 行，且能解析为 JSON。

### 4) 认领 Topic owner（签名 + X-Claim-Token）

```bash
export API_BASE_URL
node scripts/coolify/signed-request.mjs \
  POST "/v1/topics/$TOPIC_ID/commands" \
  '{"type":"CLAIM_OWNER","payload":{}}' \
  --extra-header "X-Claim-Token: $CLAIM_TOKEN" \
  | tee "$AUDIT_DIR/topic.claim-owner.out"
```

期望：HTTP 200，且后续 SSE 会出现 `topic_updated`（原因可能为 `owner_claimed`）。

### 5) 创建 Argument（签名）

> 这里故意在 JSON 末尾加空格，验证服务端按 raw body 计算 hash（而非 re-stringify）。

```bash
node scripts/coolify/signed-request.mjs \
  POST "/v1/topics/$TOPIC_ID/arguments" \
  "{\"parentId\":\"$ROOT_ID\",\"title\":null,\"body\":\"audit smoke argument\",\"initialVotes\":0} " \
  | tee "$AUDIT_DIR/argument.create.out"
```

### 6) setVotes + 强幂等重放（签名，固定 nonce+timestamp）

从 `argument.create.out` 或 `GET /tree` 中拿到新 argumentId（手动即可）；也可用公共读快速定位：

```bash
curl -fsS "$API_BASE_URL/v1/topics/$TOPIC_ID/tree?depth=3" | tee "$AUDIT_DIR/topic.tree.json"
```

手动在 `topic.tree.json` 中找到目标 `argumentId` 后执行：

```bash
ARG_ID="<<paste-argumentId>>"
TS="$(node -e 'console.log(Date.now())')"
NONCE="audit-smoke-nonce-0001"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":3}' \
  --timestamp "$TS" \
  --nonce "$NONCE" \
  | tee "$AUDIT_DIR/setVotes.first.out"

# 以完全相同 (pubkey, nonce, timestamp) 重放，期望返回“完全一致的成功响应”
node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":3}' \
  --timestamp "$TS" \
  --nonce "$NONCE" \
  | tee "$AUDIT_DIR/setVotes.replay.out"
```

通过标准：

- [ ] 首次 setVotes 为 200。
- [ ] 重放 setVotes 仍为 200，且响应体（`body`）与首次一致（强幂等）。
- [ ] SSE 中出现 `argument_updated`（reason 通常为 `new_vote`）。

## 通过标准（独立可验证）

- [ ] `api.health.json` 证明 API 可达。
- [ ] `topic.create.json` / `topic.ids.txt` 证明创建成功并拿到必要字段。
- [ ] `topic.claim-owner.out`、`argument.create.out`、`setVotes.*.out` 证明写路径可用。
- [ ] `sse.stream.log` 证明 SSE 能建立并输出事件。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/api.health.json`
- `audit-artifacts/<runId>-<sha>/worker.health.json`（可选）
- `audit-artifacts/<runId>-<sha>/topic.create.json`
- `audit-artifacts/<runId>-<sha>/sse.stream.log`
- `audit-artifacts/<runId>-<sha>/*.out`（签名请求与响应输出）

