# Audit Step 08 — `setVotes` 强幂等与资金不变量审计：事务/并发/一致性

## 目标

- 证明核心不变量持续成立：`balance + total_cost_staked == 100`（整数口径）。
- 证明 `setVotes` 写路径具备：
  - 强幂等：同 `(pubkey, nonce)` 重放返回一致成功响应（窗口期内）
  - 事务一致性：stake、ledger、argument totals 原子更新
  - 并发安全：不会出现负余额/不变量破坏/重复扣费

## 输入 / 前置条件

- 基线 commit 已固定。
- 参考口径：
  - `docs/stage01/api-contract.md#3.7`（setVotes）
  - `docs/stage01/roadmap.md`（0.x 不变量）
  - `PROJECT_REFERENCE.md#6.2`（QV 不变量）

## 操作步骤

### 0) 建立证据目录（若尚未建立）

```bash
BASELINE_SHA="$(git rev-parse HEAD)"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
AUDIT_DIR="${AUDIT_DIR:-audit-artifacts/${AUDIT_RUN_ID}-${BASELINE_SHA:0:12}}"
mkdir -p "$AUDIT_DIR"
```

### 1) 静态审查（代码级）

核对点（可逐条在代码中定位并截图/引用到报告）：

- 纯逻辑：`packages/core-logic/src/setVotes.ts`
  - `cost = votes^2`（整数）
  - `targetVotes` 约束 `0..10`（整数）
  - 余额不足返回 `402 INSUFFICIENT_BALANCE`（由 API 映射）
- API 写路径：`apps/api/src/votes/votes.service.ts`
  - 事务边界：stake/ledger/argument totals 同一 DB transaction
  - 显式锁：`FOR UPDATE` 锁定 argument/topic/ledger/stake
  - 强幂等缓存：`idemp:setVotes:<pubkey>:<nonce>`，TTL=300s，仅缓存成功响应
  - nonce 重放语义：无缓存时的 replay 必须拒绝
- 风控不破坏幂等：`apps/api/src/risk-control/risk-control.interceptor.ts`
  - `nonceReplay` 时直接放行，避免 429/blacklist 破坏强幂等回放

把结论写入：

- `$AUDIT_DIR/setVotes.code-review.md`

### 2) 黑盒验证（推荐）

#### 2.0 准备测试数据（Topic + Argument）（若你没有现成的）

```bash
test -n "${API_BASE_URL:-}" || (echo "Missing API_BASE_URL" && exit 2)

TOPIC_CREATE_RES="$AUDIT_DIR/step08.topic.create.json"
curl -fsS -X POST "$API_BASE_URL/v1/topics" \
  -H 'content-type: application/json; charset=utf-8' \
  -d "{\"title\":\"AUDIT::STEP08\",\"body\":\"${AUDIT_RUN_ID:-audit}-fixture\"}" \
  | tee "$TOPIC_CREATE_RES"

TOPIC_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).topicId)" "$TOPIC_CREATE_RES")"
ROOT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).rootArgumentId)" "$TOPIC_CREATE_RES")"
export API_BASE_URL

MARKER_BODY="AUDIT::STEP08::${AUDIT_RUN_ID:-run}"
node scripts/coolify/signed-request.mjs \
  POST "/v1/topics/$TOPIC_ID/arguments" \
  "{\"parentId\":\"$ROOT_ID\",\"title\":null,\"body\":\"$MARKER_BODY\",\"initialVotes\":0}" \
  | tee "$AUDIT_DIR/step08.argument.create.out"

curl -fsS "$API_BASE_URL/v1/topics/$TOPIC_ID/tree?depth=3" | tee "$AUDIT_DIR/step08.topic.tree.json"
ARG_ID="$(node - <<'NODE' "$AUDIT_DIR/step08.topic.tree.json" "$MARKER_BODY"
const fs = require('fs');
const tree = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const marker = process.argv[2];
const found = (tree.arguments ?? []).find((a) => a.body === marker);
if (!found) process.exit(1);
console.log(found.id);
NODE
)"
printf '%s\n' "TOPIC_ID=$TOPIC_ID" "ARG_ID=$ARG_ID" | tee "$AUDIT_DIR/step08.fixture.ids.txt"
```

#### 2.1 资金不变量（重复多次也成立）

若已执行 2.0，可直接复用 `TOPIC_ID`/`ARG_ID`；否则请自行准备一个可用的 `topicId` 与 `argumentId`。

用黑盒检查不变量（每次 setVotes 后调用 `ledger/me`）：

```bash
export API_BASE_URL
TOPIC_ID="<<paste-topicId>>"
ARG_ID="<<paste-argumentId>>"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":1}' \
  | tee "$AUDIT_DIR/setVotes.1.out"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":3}' \
  | tee "$AUDIT_DIR/setVotes.3.out"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":0}' \
  | tee "$AUDIT_DIR/setVotes.0.out"

node scripts/coolify/signed-request.mjs \
  GET "/v1/topics/$TOPIC_ID/ledger/me" \
  | tee "$AUDIT_DIR/ledger.me.out"
```

通过标准（人工核对即可）：

- [ ] `ledger.me.out` 的响应体中 `balance + myTotalCost == 100`。

#### 2.2 强幂等（同 nonce 重放返回一致成功响应）

```bash
TS="$(node -e 'console.log(Date.now())')"
NONCE="audit-idemp-0001"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":2}' \
  --timestamp "$TS" \
  --nonce "$NONCE" \
  | tee "$AUDIT_DIR/idemp.first.out"

node scripts/coolify/signed-request.mjs \
  POST "/v1/arguments/$ARG_ID/votes" \
  '{"targetVotes":2}' \
  --timestamp "$TS" \
  --nonce "$NONCE" \
  | tee "$AUDIT_DIR/idemp.replay.out"
```

通过标准：

- [ ] 两次均为 200。
- [ ] 两次响应体（`body` 字段）完全一致（包括 ledger 数值）。

#### 2.3 并发一致性（可选但强烈建议）

对同一 `ARG_ID` 并发打 20 次随机 `targetVotes`（观察是否出现 500/负余额/不变量破坏）：

```bash
for i in $(seq 1 20); do
  v=$((RANDOM % 11))
  node scripts/coolify/signed-request.mjs \
    POST "/v1/arguments/$ARG_ID/votes" \
    "{\"targetVotes\":$v}" \
    > "$AUDIT_DIR/concurrency.$i.out" &
done
wait
```

最后再拉一次 ledger：

```bash
node scripts/coolify/signed-request.mjs \
  GET "/v1/topics/$TOPIC_ID/ledger/me" \
  | tee "$AUDIT_DIR/ledger.after-concurrency.out"
```

通过标准：

- [ ] 无 500。
- [ ] `balance` 未出现负值。
- [ ] `balance + myTotalCost == 100` 仍成立。

## 通过标准（独立可验证）

- [ ] `setVotes.code-review.md` 明确事务/锁/幂等/与风控交互。
- [ ] 黑盒输出文件存在，且可从响应体复核不变量与强幂等。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/setVotes.code-review.md`
- `audit-artifacts/<runId>-<sha>/setVotes.*.out`
- `audit-artifacts/<runId>-<sha>/idemp.*.out`
- `audit-artifacts/<runId>-<sha>/ledger.*.out`
- `audit-artifacts/<runId>-<sha>/concurrency.*.out`（可选）
