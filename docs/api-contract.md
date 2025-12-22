# API 契约（v1.0）

本文档定义 **AI 思想市场（The Thought Market）** 的 HTTP API + SSE 事件契约，目标是作为前后端/Worker 的 **Single Source of Truth**。

对齐文档：

- `docs/architecture.md`（鉴权、SSE、读写路径与决策清单）
- `docs/database.md`（字段语义与一致性约束）

---

## 0. 版本与通用约定

- API Prefix：`/v1`（v1.0 强制；本文档不强制域名）
- 数据编码：
  - 请求体/响应体：`application/json; charset=utf-8`
  - SSE：`text/event-stream; charset=utf-8`
- Hex：所有对外传输的 hex 字符串统一使用 **小写（lowercase）**
- ID：
  - `topicId` / `argumentId`：UUID v7 字符串（例如 `0193e3a6-0b7d-7a8d-9f2c-...`）
- 时间：
  - Header `X-Timestamp`：Unix ms（number）
  - 响应 `...At`：ISO 8601（`2025-12-19T12:34:56.789Z`）
- JSON 字段命名：`camelCase`
- 金额/票数：
  - `votes`：整数（MVP 固定 step=1）
  - `cost = votes^2`：整数
  - `balance`：整数（每 Topic 初始 100）

---

## 1. 鉴权与签名（Ed25519）

> 目标：后端不建立跨 Topic 的用户关联；身份以 `(topicId, pubkey)` 为最小粒度出现。
>
> 密钥派生与签名算法的完整规范见 `docs/crypto.md`；本文档主要冻结 HTTP 层 headers 与 canonical message 格式。

### 1.1 需要签名的请求

- **所有写请求**（除 `POST /v1/topics` 创建 Topic 的第一步外）
- **私密读**（只对当前身份有意义）：
  - `GET /v1/topics/:topicId/ledger/me`
  - `GET /v1/topics/:topicId/stakes/me`
- 批量私密读（每个 item 自带签名）：
  - `POST /v1/user/batch-balance`

公共读（不签名，利于缓存）：

- `GET /v1/topics`
- `GET /v1/topics/:topicId/tree`
- `GET /v1/arguments/:argumentId/children`
- `GET /v1/topics/:topicId/cluster-map`
- `GET /v1/sse/:topicId`

### 1.2 签名 Headers（v1.0）

- `X-Pubkey`：hex（小写，64 chars，32 bytes）
- `X-Signature`：hex（小写，128 chars，64 bytes）
- `X-Timestamp`：Unix ms（number）
- `X-Nonce`：随机串（建议 base64url/hex；禁止包含 `|`）

Host 认领额外 header：

- `X-Claim-Token`：仅 `CLAIM_OWNER` 需要

### 1.3 Canonical Message（v1.0）

不直接签 JSON 对象，而签固定字段拼接的 raw string（避免跨语言 JSON 序列化差异）：

```
v1|METHOD|PATH|TIMESTAMP|NONCE|BODY_HASH
```

- `METHOD`：`GET/POST/...`（全大写）
- `PATH`：请求路径（不含域名、不含 query string），例如 `/v1/topics/xxx/ledger/me`
- `TIMESTAMP`：`X-Timestamp`
- `NONCE`：`X-Nonce`
- `BODY_HASH`：
  - 若 body 为空：`""`（空字符串）
  - 否则：`sha256(rawBodyString)` 的 hex（64 chars，小写）

注意：当 `BODY_HASH=""` 时，canonical message 的最后一段为空，因此字符串会以 `|` 结尾（实现必须保持一致）。

实现要点：

- 后端必须基于 **原始请求体 raw string** 计算 hash（不要对解析后的对象 re-stringify）。
- 客户端必须对“即将发送的 body 字符串”做 hash；不要对对象做 hash 后再 stringify。

### 1.4 防重放与幂等

- `X-Timestamp`：要求 `abs(now - ts) < 60s`
- `X-Nonce`：
  - 去重：Redis 记录已用 nonce（TTL 60s）
  - 幂等（强写）：对 `setVotes` 等写请求，Redis 以 `(pubkey, nonce)` 缓存 5 分钟并复用上次成功响应

---

## 2. 通用枚举与对象

### 2.1 枚举

- `TopicStatus`：`active | frozen | archived`
- `ArgumentAnalysisStatus`：`pending_analysis | ready | failed`
- `Stance`（用于 UI bucket）：`-1 | 0 | 1`

### 2.2 通用错误响应

所有错误统一 JSON 结构：

```json
{
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "签名验证失败",
    "details": {}
  }
}
```

约定：

- `error.code`：稳定的英文 code（便于前端分支处理）
- `error.message`：可中文/英文（面向开发者）
- `error.details`：可选对象

常见 `error.code`（v1.0）：

- `BAD_REQUEST`
- `INVALID_SIGNATURE`
- `TIMESTAMP_OUT_OF_RANGE`
- `NONCE_REPLAY`
- `NOT_TOPIC_OWNER`
- `TOPIC_NOT_FOUND`
- `ARGUMENT_NOT_FOUND`
- `TOPIC_STATUS_DISALLOWS_WRITE`
- `ARGUMENT_PRUNED_INCREASE_FORBIDDEN`
- `INSUFFICIENT_BALANCE`
- `CLAIM_TOKEN_INVALID`
- `CLAIM_TOKEN_EXPIRED`
- `RATE_LIMITED`

HTTP 状态码建议（v1.0）：

- `400`：`BAD_REQUEST`
- `401`：签名/时间窗问题（`INVALID_SIGNATURE` / `TIMESTAMP_OUT_OF_RANGE`）
- `403`：权限（`NOT_TOPIC_OWNER`）
- `404`：资源不存在（`TOPIC_NOT_FOUND` / `ARGUMENT_NOT_FOUND`）
- `409`：nonce 重放/状态冲突（`NONCE_REPLAY` / `TOPIC_STATUS_DISALLOWS_WRITE` / `ARGUMENT_PRUNED_INCREASE_FORBIDDEN`）
- `402`：余额不足（`INSUFFICIENT_BALANCE`）
- `429`：限流（`RATE_LIMITED`）

### 2.3 Topic（摘要）

```ts
type TopicSummary = {
  id: string; // topicId
  title: string; // 列表页缓存；以 Root Argument 为准
  rootArgumentId: string;
  status: "active" | "frozen" | "archived";
  ownerPubkey: string | null; // hex
  createdAt: string; // ISO
  updatedAt: string; // ISO
};
```

### 2.4 Argument

```ts
type Argument = {
  id: string; // argumentId
  topicId: string;
  parentId: string | null; // Root 为 null
  title: string | null;
  body: string;
  authorId: string; // hex（Topic 内派生身份公钥的稳定短 hash；见下）

  analysisStatus: "pending_analysis" | "ready" | "failed";
  stanceScore: number | null; // ready 才可信；范围 [-1,1]

  totalVotes: number; // Int
  totalCost: number; // Int

  prunedAt: string | null; // v1.0 公共读默认不返回 pruned 节点

  createdAt: string;
  updatedAt: string;
};
```

`authorId` 生成规则（v1.0）：

- 输入：作者 `pubkey`（32 bytes）
- 算法：`authorId = sha256(pubkey_bytes).hex().slice(0, 16)`（16 hex chars，小写）

### 2.5 Ledger（我的余额）

```ts
type LedgerMe = {
  topicId: string;
  pubkey: string; // hex
  balance: number; // Int
  myTotalVotes: number; // Int
  myTotalCost: number; // Int
  lastInteractionAt: string | null; // ISO
};
```

### 2.6 Stake（我的质押）

```ts
type StakeMeItem = {
  argumentId: string;
  votes: number; // Int
  cost: number; // votes^2
  argumentPrunedAt: string | null;
  updatedAt: string; // ISO

  // 可选：便于 UI 识别（避免再拉 argument）
  argumentTitle: string | null;
  argumentExcerpt: string | null;
};
```

### 2.7 Cluster Map（God View）

```ts
type ClusterMap = {
  topicId: string;
  modelVersion: string; // 例如 "v1-2025-12-19T12:00:00.000Z"
  computedAt: string; // ISO
  points: Array<{
    argumentId: string;
    x: number; // [-1, 1]
    y: number; // [-1, 1]
    clusterId: string;
    stance: -1 | 0 | 1; // stanceScore 阈值映射
    weight: number; // log(totalVotes + 1)
  }>;
  clusters: Array<{
    id: string;
    label: string | null;
    summary: string | null;
    centroid: { x: number; y: number };
  }>;
};
```

Stance 映射（v1.0，与 `docs/architecture.md` 一致）：

- `stanceScore <= -0.3` → `stance=-1`
- `-0.3 < stanceScore < 0.3` → `stance=0`
- `stanceScore >= 0.3` → `stance=1`
- 若 `stanceScore` 为 `null`（`analysisStatus != ready`）：`stance=0`

### 2.8 Consensus Report（共识报告）

```ts
type ConsensusReport =
  | {
      id: string; // reportId
      topicId: string;
      status: "generating";
      contentMd: null;
      model: string | null;
      promptVersion: string | null;
      params: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null;
      computedAt: null;
      createdAt: string; // ISO
    }
  | {
      id: string; // reportId
      topicId: string;
      status: "ready";
      contentMd: string; // Markdown
      model: string | null;
      promptVersion: string | null;
      params: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null;
      computedAt: string; // ISO
      createdAt: string; // ISO
    }
  | {
      id: string; // reportId
      topicId: string;
      status: "failed";
      contentMd: null;
      model: string | null;
      promptVersion: string | null;
      params: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null; // error 写入 metadata
      computedAt: string; // ISO
      createdAt: string; // ISO
    };
```

### 2.9 SSE 事件（Entity Invalidation）

SSE `data:` 字段统一为 JSON：

```ts
type SseEnvelope =
  | { event: "argument_updated"; data: { argumentId: string; reason: "new_vote" | "analysis_done" | "edited" | "pruned" } }
  | { event: "topic_updated"; data: { topicId: string; reason: "status_changed" | "owner_claimed" | "root_edited" } }
  | { event: "cluster_updated"; data: { topicId: string } }
  | { event: "report_updated"; data: { topicId: string; reportId: string } }
  | { event: "reload_required"; data: { reason: "trimmed" } };
```

---

## 3. API 定义

### 3.1 `POST /v1/topics`（创建 Topic：第一步，不签名）

用途：创建 Topic 与 Root Argument，并返回 `claimToken`（用于后续 `CLAIM_OWNER` 防抢占认领）。

请求体：

```json
{
  "title": "string",
  "body": "string"
}
```

响应（200）：

```json
{
  "topicId": "uuidv7",
  "rootArgumentId": "uuidv7",
  "claimToken": "string",
  "expiresAt": "2025-12-19T12:34:56.789Z"
}
```

错误：

- `400 BAD_REQUEST`
- `429 RATE_LIMITED`（建议对未签名创建做更严格限流）

---

### 3.2 `POST /v1/topics/:topicId/commands`（Host 管理：命令模式，需签名）

鉴权：

- 必须带签名 headers
- `type=CLAIM_OWNER` 额外需要 `X-Claim-Token`
- 除 `CLAIM_OWNER` 外，其余命令要求 `X-Pubkey === topics.ownerPubkey`

Topic 状态限制（v1.0，见 `docs/architecture.md` 决策清单）：

- `active`：允许所有 Host 命令
- `frozen`：仅允许 `SET_STATUS(active)` 解冻
- `archived`：不再接受 Host 命令（只读不可逆）

请求体（Discriminated Union）：

```ts
type TopicCommand =
  | { type: "CLAIM_OWNER"; payload: {} }
  | { type: "SET_STATUS"; payload: { status: "active" | "frozen" | "archived" } }
  | { type: "EDIT_ROOT"; payload: { title: string; body: string } }
  | { type: "PRUNE_ARGUMENT"; payload: { argumentId: string; reason: string | null } }
  | { type: "UNPRUNE_ARGUMENT"; payload: { argumentId: string } }
  | { type: "GENERATE_CONSENSUS_REPORT"; payload: {} };
```

响应（200）：返回最小可用回执（前端依赖 SSE + 拉取刷新即可）

```json
{
  "topic": {
    "id": "uuidv7",
    "title": "string",
    "rootArgumentId": "uuidv7",
    "status": "active",
    "ownerPubkey": "hex-or-null",
    "createdAt": "ISO",
    "updatedAt": "ISO"
  }
}
```

错误：

- `401 INVALID_SIGNATURE | TIMESTAMP_OUT_OF_RANGE`
- `403 NOT_TOPIC_OWNER`
- `404 TOPIC_NOT_FOUND | ARGUMENT_NOT_FOUND`
- `409 NONCE_REPLAY | TOPIC_STATUS_DISALLOWS_WRITE`
- `400 CLAIM_TOKEN_INVALID | CLAIM_TOKEN_EXPIRED`（仅 CLAIM_OWNER）

---

### 3.3 `GET /v1/topics`（Topic 列表，公共读）

查询参数：

- `orderBy`：`createdAt_desc`（默认）
- `limit`：默认 `20`，最大 `100`
- `beforeId`：cursor（可选，UUID v7）

响应（200）：

```json
{
  "items": [
    {
      "id": "uuidv7",
      "title": "string",
      "rootArgumentId": "uuidv7",
      "status": "active",
      "ownerPubkey": null,
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  ],
  "nextBeforeId": "uuidv7-or-null"
}
```

---

### 3.4 `GET /v1/topics/:topicId/tree?depth=3`（Focus View 首屏树，公共读）

查询参数：

- `depth`：默认 `3`；最小 `1`；建议最大 `6`

响应（200）：

```json
{
  "topic": { "id": "uuidv7", "title": "string", "rootArgumentId": "uuidv7", "status": "active", "ownerPubkey": null, "createdAt": "ISO", "updatedAt": "ISO" },
  "depth": 3,
  "arguments": [
    {
      "id": "uuidv7",
      "topicId": "uuidv7",
      "parentId": null,
      "title": "string",
      "body": "string",
      "authorPubkey": "hex",
      "analysisStatus": "pending_analysis",
      "stanceScore": null,
      "totalVotes": 0,
      "totalCost": 0,
      "prunedAt": null,
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  ]
}
```

约定：

- v1.0 公共读默认 **不返回** pruned 节点（由 Host pruning 隐藏）；My Activity 通过 `GET /v1/topics/:topicId/stakes/me` 找回资金。

错误：

- `404 TOPIC_NOT_FOUND`

---

### 3.5 `GET /v1/arguments/:argumentId/children`（懒加载子节点 / Dialogue Stream，公共读）

查询参数：

- `orderBy`：`totalVotes_desc`（默认）或 `createdAt_desc`
- `limit`：默认 `30`，最大 `100`
- `beforeId`：cursor（可选；上一页最后一条 `argumentId`）

响应（200）：

```json
{
  "parentArgumentId": "uuidv7",
  "items": [/* Argument[] */],
  "nextBeforeId": "uuidv7-or-null"
}
```

错误：

- `404 ARGUMENT_NOT_FOUND`

---

### 3.6 `POST /v1/topics/:topicId/arguments`（发言：创建 Argument，需签名）

请求体：

```json
{
  "parentId": "uuidv7",
  "title": null,
  "body": "string",
  "initialVotes": 0
}
```

约定：

- `parentId` 必填（Root 已由 `POST /v1/topics` 创建）
- `initialVotes` 可选；不传等价于 `0`
- 若携带 `initialVotes`：同一事务内完成扣费与 stake 写入；余额不足则整笔失败、不落库 Argument
- Topic 状态：
  - `active`：允许创建
  - `frozen/archived`：禁止创建（返回 `409 TOPIC_STATUS_DISALLOWS_WRITE`）
- Pruned：
  - 若 `parentId` 指向 pruned 节点：允许创建（pruning 影响展示与投票规则，不影响“回复关系”）

响应（200）：

```json
{
  "argument": { /* Argument */ },
  "ledger": { /* LedgerMe */ }
}
```

错误：

- `401 INVALID_SIGNATURE | TIMESTAMP_OUT_OF_RANGE`
- `404 TOPIC_NOT_FOUND | ARGUMENT_NOT_FOUND`
- `402 INSUFFICIENT_BALANCE`
- `409 NONCE_REPLAY | TOPIC_STATUS_DISALLOWS_WRITE`

---

### 3.7 `POST /v1/arguments/:argumentId/votes`（QV：setVotes，需签名）

请求体：

```json
{
  "targetVotes": 3
}
```

约定：

- `targetVotes`：整数 `0..10`
- pruned 节点：禁止加票，仅允许 `targetVotes <= currentVotes` 撤回
- Topic 状态：
  - `active`：允许加票/撤回
  - `frozen/archived`：仅允许撤回/减票；若 `targetVotes > currentVotes` 返回 `409 TOPIC_STATUS_DISALLOWS_WRITE`
- 幂等：`X-Nonce` 作为 idempotency key（5 分钟）

响应（200）：

```json
{
  "argumentId": "uuidv7",
  "previousVotes": 1,
  "targetVotes": 3,
  "deltaVotes": 2,
  "previousCost": 1,
  "targetCost": 9,
  "deltaCost": 8,
  "ledger": { /* LedgerMe */ }
}
```

错误：

- `401 INVALID_SIGNATURE | TIMESTAMP_OUT_OF_RANGE`
- `404 ARGUMENT_NOT_FOUND`
- `402 INSUFFICIENT_BALANCE`
- `409 NONCE_REPLAY | TOPIC_STATUS_DISALLOWS_WRITE | ARGUMENT_PRUNED_INCREASE_FORBIDDEN`

---

### 3.8 `GET /v1/topics/:topicId/ledger/me`（我的余额，需签名）

响应（200）：`LedgerMe`

约定：若 Ledger 不存在，后端应视为首次交互并返回默认余额（`balance=100`，其余为 0/NULL）。

错误：

- `401 INVALID_SIGNATURE | TIMESTAMP_OUT_OF_RANGE`
- `404 TOPIC_NOT_FOUND`
- `409 NONCE_REPLAY`

---

### 3.9 `GET /v1/topics/:topicId/stakes/me`（列出我的质押，需签名）

响应（200）：

```json
{
  "topicId": "uuidv7",
  "pubkey": "hex",
  "items": [
    {
      "argumentId": "uuidv7",
      "votes": 3,
      "cost": 9,
      "argumentPrunedAt": null,
      "updatedAt": "ISO",
      "argumentTitle": null,
      "argumentExcerpt": "string"
    }
  ]
}
```

错误：

- `401 INVALID_SIGNATURE | TIMESTAMP_OUT_OF_RANGE`
- `404 TOPIC_NOT_FOUND`
- `409 NONCE_REPLAY`

---

### 3.10 `POST /v1/user/batch-balance`（批量余额查询，item 级签名）

用途：My Activity 页面避免 N+1（不在服务端持久化 topic 列表）。

请求体：

```json
{
  "items": [
    {
      "topicId": "uuidv7",
      "pubkey": "hex",
      "timestamp": 1734567890123,
      "nonce": "string",
      "signature": "hex"
    }
  ]
}
```

签名规则（每个 item）：

- 使用该 `topicId` 派生的私钥，对“等价请求”`GET /v1/topics/:topicId/ledger/me`（无 body）做 v1.0 canonical message 签名：
  - `v1|GET|/v1/topics/{topicId}/ledger/me|{timestamp}|{nonce}|`

响应（200）：

```json
{
  "results": [
    {
      "topicId": "uuidv7",
      "ok": true,
      "balance": 100,
      "myTotalVotes": 0,
      "myTotalCost": 0,
      "lastInteractionAt": null
    }
  ]
}
```

备注：单个 item 验签失败不影响其它 item；失败项返回 `{ ok:false, error:{...} }`。

---

### 3.11 `GET /v1/topics/:topicId/cluster-map`（God View，公共读）

响应（200）：`ClusterMap`

错误：

- `404 TOPIC_NOT_FOUND`

---

### 3.12 `GET /v1/sse/:topicId`（SSE：Topic 维度事件流，公共读）

用途：Entity invalidation（只推 `id + reason`，不推私密数据）。

请求：

- Header `Accept: text/event-stream`
- 断线续传：浏览器自动携带 `Last-Event-ID`

响应：SSE（示例）

```
id: 167888888-0
data: {"event":"argument_updated","data":{"argumentId":"...","reason":"new_vote"}}

```

断线续传（v1.0）：

- 事件持久化：Redis Stream `topic:events:{topicId}`，`XADD`，`MAXLEN ~ 1000`
- 补发：`XRANGE topic:events:{topicId} (<lastId> +`
- 若 `Last-Event-ID` 过旧：发送 `reload_required`

---

### 3.13 `GET /v1/topics/:topicId/consensus-report/latest`（共识报告：latest，公共读）

响应（200）：

```json
{
  "report": null
}
```

或：

```json
{
  "report": {
    "id": "uuidv7",
    "topicId": "uuidv7",
    "status": "ready",
    "contentMd": "# ...",
    "model": "string-or-null",
    "promptVersion": "string-or-null",
    "params": {},
    "metadata": {},
    "computedAt": "ISO",
    "createdAt": "ISO"
  }
}
```

错误：

- `404 TOPIC_NOT_FOUND`
