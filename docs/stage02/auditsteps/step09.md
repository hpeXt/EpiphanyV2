# Audit Step 09 — SSE 审计：invalidation-only、续传/trim、隐私泄露

## 目标

- 证明 SSE 只推 invalidation（`id + reason`），不携带私密数据（ledger/stakes/余额等）。
- 证明 Last-Event-ID 续传与 “trim → reload_required” 语义清晰且可验证。

## 输入 / 前置条件

- 基线 commit 已固定。
- 黑盒验证需要 `API_BASE_URL`，并有可用 topicId（可用 Step 03 创建）。
- 参考口径：
  - `docs/stage01/api-contract.md#2.9`（SSE envelope）
  - `packages/shared-contracts/src/sse.ts`（union schema）

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

- SSE union schema 仅包含最小字段（ID + reason）：`packages/shared-contracts/src/sse.ts`
- Redis Stream → SSE chunk 的解析与二次校验：`apps/api/src/sse/sse.service.ts`、`apps/api/src/sse/sse.utils.ts`
- 发布端对 envelope 做 schema parse（剥离未知字段）：`apps/api/src/sse/topic-events.publisher.ts`
- 事件上限（MAXLEN）与 trim 行为：`MAXLEN ~ 1000`，`reload_required(reason="trimmed")`

把结论写入：

- `$AUDIT_DIR/sse.code-review.md`

### 2) 黑盒验证：payload 不得包含私密字段

```bash
test -n "${API_BASE_URL:-}" || (echo "Missing API_BASE_URL" && exit 2)
```

#### 2.0 准备一个会产生事件的测试 Topic（若你没有现成的）

> SSE 是按 topicId 分 stream 的；为了在日志里看到 `data:`，你需要触发至少一次 `argument_updated`（例如 setVotes）。

```bash
TOPIC_CREATE_RES="$AUDIT_DIR/step09.topic.create.json"
curl -fsS -X POST "$API_BASE_URL/v1/topics" \
  -H 'content-type: application/json; charset=utf-8' \
  -d "{\"title\":\"AUDIT::STEP09\",\"body\":\"${AUDIT_RUN_ID:-audit}-fixture\"}" \
  | tee "$TOPIC_CREATE_RES"

TOPIC_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).topicId)" "$TOPIC_CREATE_RES")"
ROOT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).rootArgumentId)" "$TOPIC_CREATE_RES")"
export API_BASE_URL

MARKER_BODY="AUDIT::STEP09::${AUDIT_RUN_ID:-run}"
node scripts/coolify/signed-request.mjs \
  POST "/v1/topics/$TOPIC_ID/arguments" \
  "{\"parentId\":\"$ROOT_ID\",\"title\":null,\"body\":\"$MARKER_BODY\",\"initialVotes\":0}" \
  | tee "$AUDIT_DIR/step09.argument.create.out"

curl -fsS "$API_BASE_URL/v1/topics/$TOPIC_ID/tree?depth=3" | tee "$AUDIT_DIR/step09.topic.tree.json"
ARG_ID="$(node - <<'NODE' "$AUDIT_DIR/step09.topic.tree.json" "$MARKER_BODY"
const fs = require('fs');
const tree = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const marker = process.argv[2];
const found = (tree.arguments ?? []).find((a) => a.body === marker);
if (!found) process.exit(1);
console.log(found.id);
NODE
)"
printf '%s\n' "TOPIC_ID=$TOPIC_ID" "ARG_ID=$ARG_ID" | tee "$AUDIT_DIR/step09.fixture.ids.txt"
```

#### 2.1 订阅 SSE 并触发一次事件

订阅 SSE（收到若干事件后 Ctrl-C）：

```bash
curl -N -H 'Accept: text/event-stream' "$API_BASE_URL/v1/sse/$TOPIC_ID" \
  | tee "$AUDIT_DIR/sse.capture.log"
```

在另一个终端触发一次 `argument_updated`（例如 setVotes）：

```bash
node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":1}' \
  | tee "$AUDIT_DIR/step09.setVotes.trigger.out"
```

检查点（可 grep 作为证据）：

```bash
# 不应出现敏感关键词（仅作粗筛，最终以人工复核为准）
rg -n "balance|stakes|ledger|pubkey|signature|claimToken" "$AUDIT_DIR/sse.capture.log" || true
```

通过标准：

- [ ] `sse.capture.log` 中的 `data:` JSON 仅包含 `event` 与最小 `data` 字段（ID + reason）。
- [ ] 不出现 ledger/stakes/balance 等私密数据。

### 3) 黑盒验证：Last-Event-ID 续传（最小可验证）

从 `sse.capture.log` 中取一个事件 id（形如 `1234567890123-0`）：

```bash
LAST_ID="<<paste-last-event-id>>"
curl -N -H 'Accept: text/event-stream' -H "Last-Event-ID: $LAST_ID" \
  "$API_BASE_URL/v1/sse/$TOPIC_ID" \
  | tee "$AUDIT_DIR/sse.resume.log"
```

通过标准：

- [ ] `sse.resume.log` 中能继续收到后续事件（或按实现先发 keep-alive/comment）。

## 通过标准（独立可验证）

- [ ] `sse.code-review.md` 覆盖 schema、发布端 sanitize、消费端校验、trim 语义。
- [ ] `sse.capture.log`/`sse.resume.log` 可复核“不泄露私密数据 + 可续传”。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/sse.code-review.md`
- `audit-artifacts/<runId>-<sha>/sse.capture.log`
- `audit-artifacts/<runId>-<sha>/sse.resume.log`
