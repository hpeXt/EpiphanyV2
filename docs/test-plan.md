# 全量测试规划（Server Acceptance First）

> 目标：后续所有“验收”都在服务器环境发生（staging/验收机/CI runner），因此测试体系以 **可部署、可黑盒验收、可重复运行** 为第一原则。
>
> 本文是测试规划，不替代 TDD 的 step 文档：实现过程仍按 `docs/steps/stepXX.md` 逐步落地（每步先测后写）。

## 0. 参考文档（Single Source of Truth）

- Roadmap：`docs/roadmap.md`
- API 契约：`docs/api-contract.md`
- DB 语义与不变量：`docs/database.md`
- Crypto/签名：`docs/crypto.md`
- 核心端到端流程：`docs/core-flows.md`
- 架构决策与边界：`docs/architecture.md`
- Worker 设计：`docs/ai-worker.md`
- UI/设计规范（用于 UI 验收，不影响服务端口径）：`docs/design.md`、`docs/prd.md`

## 1. 验收环境与原则

### 1.1 环境分层

1) **本地开发（Dev Local）**  
仅用于开发者自测；不作为最终验收依据。

2) **CI（Pre-merge / PR Gate）**  
运行单测/契约测试/部分集成测试，保证每次合并不破坏不变量。

3) **服务器验收（Server Acceptance / Staging）**（本文重点）  
在“接近生产”的部署形态下进行黑盒验收，覆盖：API + DB + Redis + Worker + SSE +（可选）Web E2E。

### 1.2 服务器验收的硬约束

- **可重复**：同一套测试可在任何干净环境重复跑通（幂等、可清理）。
- **黑盒优先**：验收以“对外 HTTP/SSE 行为 + DB 不变量”验证为主，减少对内部实现细节的耦合。
- **稳定与可控**：
  - AI 默认使用 `AI_PROVIDER=mock`（确定性输出，避免网络/额度/波动）。
  - 聚类默认 `CLUSTER_ENGINE=node` 或 `python` 任选其一，但必须可在验收机上可复现。
- **契约冻结**：接口字段、错误码、SSE envelope 以 `docs/api-contract.md` 为准；任何变更必须先改文档再改实现与测试。

### 1.3 统一验收入口（建议）

将验收测试按“可执行套件”组织（可落到 `apps/e2e-blackbox` 或 `packages/acceptance`）：

- `smoke`：5 分钟内完成，部署后立刻跑（健康检查 + 关键写路径冒烟）。
- `acceptance`：覆盖核心流程 1~6（见 `docs/core-flows.md`）。
- `regression`：全量回归（含边界/并发/安全/性能基线），可夜间跑。

### 1.4 Coolify CLI（本项目默认验收通道）

本项目的“服务器验收”默认通过 **Coolify CLI + HTTP 交互**完成：

- 资源状态/部署日志/运行日志：`coolify app|database|service ...`
- 对外行为验证：对部署后的 `API_BASE_URL/WEB_BASE_URL` 发起 `curl`/脚本请求（按 `docs/api-contract.md` 验收）

运行手册见：`docs/coolify-acceptance.md`（含 context 配置、资源定位、部署/日志/重启、SSE 验收）。

签名接口建议使用脚本生成 headers：`scripts/coolify/signed-request.mjs`（默认把临时 key 缓存到 `tmp/`，避免手工算签名出错）。

## 2. 测试类型与覆盖面（分层）

### 2.1 单元测试（Unit）

目标：用最小成本锁死核心规则，不依赖网络/真实 DB。

- `packages/core-logic`：QV `setVotes` 计算与不变量（`balance + totalCostStaked == 100`，整数）。
- `packages/crypto`：BIP39/派生/canonical message/sign/verify（含测试向量）。
- `packages/shared-contracts`：Zod schema parse（错误结构、DTO、SSE event union）。

验收机要求：必须在无外部网络情况下稳定通过。

### 2.2 契约测试（Contract）

目标：保证 API 输出严格符合契约（字段、类型、枚举、错误码、SSE envelope）。

策略：

- **服务端响应**：黑盒请求后，用 `packages/shared-contracts` 对 response 进行 runtime parse。
- **错误响应**：所有非 2xx 必须满足 `{ error: { code, message, details? } }`，且 `code` 在允许集合内（见 `docs/api-contract.md#2.2`）。

### 2.3 集成测试（Integration）

目标：验证 DB/Redis/事务/SSE/幂等等“跨组件不变量”。

- DB migrations：空库可跑、重复可跑。
- Redis：
  - nonce 去重 TTL 60s
  - `setVotes` 幂等缓存 TTL 5min
  - Redis Stream：`topic:events:{topicId}`，`MAXLEN ~ 1000`，支持 `Last-Event-ID`
- 事务一致性：`setVotes` 与 `createArgument(initialVotes)` 的原子性与回滚语义（余额不足整笔失败）。

### 2.4 端到端黑盒验收（E2E Blackbox / Server Acceptance）

目标：覆盖 `docs/core-flows.md` 的端到端流程，真实起 API+DB+Redis+Worker（可选 Web）。

核心点：

- **签名 v1**（headers + canonical message + raw body hash）
- **幂等与防重放**（timestamp window 60s，nonce 去重 60s，`setVotes` 强幂等 5min）
- **pruning 口径**（公共读不返回 pruned，私密读可见并可撤回）
- **SSE invalidation**（只推 `id+reason`，续传/过旧 reload_required）
- **AI 异步回填**（mock provider 也要覆盖 ready/failed 两条路径）

### 2.5 非功能测试（Non-functional）

在服务器验收环境做“可量化”的基线，不追求一次性做到完美，但必须可持续演进：

- 性能：`setVotes` 并发下仍守恒、不死锁，P95 延迟达标（阈值由团队定义）。
- 可靠性：Worker 重启/重试不导致数据膨胀（幂等）。
- 安全：签名/重放/越权/注入/敏感信息泄露（日志与响应）不破底线。

## 3. 服务器验收：测试准备与数据策略

### 3.1 依赖服务

最低依赖（MVP）：

- PostgreSQL（含 pgvector extension）
- Redis
- API（NestJS）
- Worker（BullMQ consumer）
- Web（可选，若做 UI E2E）

### 3.2 验收环境变量（建议最小集）

- `DATABASE_URL`
- `REDIS_URL`
- `PORT`（API）
- `NEXT_PUBLIC_API_URL`（Web）
- `AI_PROVIDER=mock|real`
- `CLUSTER_ENGINE=node|python`

### 3.3 测试数据隔离与清理

原则：验收套件必须“自建数据、自清理”或使用“专用测试库”直接重置。

推荐策略（按优先级）：

1) **专用测试数据库**：每次验收前 `DROP/CREATE` 或迁移到全新 schema。  
2) **命名空间隔离**：Topic 标题加前缀 `E2E::<runId>`，并在测试结束时按前缀清理。  
3) **只追加不清理**（不推荐）：会导致 state 污染与 flaky，除非环境不可重置。

### 3.4 时间与随机性（避免 flaky）

- `X-Timestamp`：验收机上运行测试，确保时钟正确（NTP）；测试生成 `Date.now()` 即可。
- `X-Nonce`：使用强随机（base64url/hex），禁止包含 `|`（见契约）。
- AI mock：必须是确定性的（同输入同输出），以保证 snapshot/断言稳定。

## 4. 服务器验收套件（按核心流程组织）

> 以下每条都应落成“可执行测试用例”，并对响应做契约 parse（shared-contracts）。

### Suite A — 基础健康检查（Smoke）

- A1. `GET /health`：API 在线；DB/Redis 连接 OK（Step 01）。
- A2. migrations 已应用：关键表存在（topics/arguments/ledgers/stakes…）。
- A3. Worker 在线：能消费一个最小 job（可用 mock queue 或 ping endpoint）。

### Suite B — Flow 1：创建 Topic + Host 认领

对齐：`docs/core-flows.md#1`、`docs/api-contract.md#3.1/#3.2`。

- B1. `POST /v1/topics`：返回 `topicId/rootArgumentId/claimToken/expiresAt`；DB 内 Topic+Root 同事务生成。
- B2. `CLAIM_OWNER`：
  - 正确 token + 正确签名：`topics.owner_pubkey` 写入成功。
  - token 过期/复用：分别返回 `CLAIM_TOKEN_EXPIRED/CLAIM_TOKEN_INVALID`（或等价错误码，需与契约一致）。
- B3. 越权：非 owner 执行 host-only command → `403 NOT_TOPIC_OWNER`（后续 Step 21 回归）。

### Suite C — Flow 2：公共读（tree/children）+ pruning 过滤

对齐：`docs/core-flows.md#2`、`docs/api-contract.md#3.4/#3.5`。

- C1. `GET /v1/topics/:topicId/tree?depth=3`：depth 语义正确（超过深度不返回）。
- C2. `GET /v1/arguments/:id/children`：
  - `orderBy=totalVotes_desc` 与 `createdAt_desc` 排序正确
  - cursor 分页稳定（不会重复/丢失）
- C3. pruning 过滤：公共读默认不返回 `prunedAt != null` 的节点。

### Suite D — Flow 3：发言（createArgument + optional initialVotes）+ AI 回填

对齐：`docs/core-flows.md#3`、`docs/api-contract.md#3.6`、`docs/database.md#6.2`。

- D1. 需要签名：缺少/错误签名 → `401 INVALID_SIGNATURE`。
- D2. topic/status 校验：
  - topic 不存在 → `404 TOPIC_NOT_FOUND`
  - frozen/archived → `409 TOPIC_STATUS_DISALLOWS_WRITE`
- D3. `initialVotes` 原子性：
  - 余额不足：返回 `402 INSUFFICIENT_BALANCE`，且 DB 中不产生 argument/stake，ledger 不变。
  - 成功：argument 创建 + ledger 扣费 + stake 写入 + totals 更新同事务完成。
- D4. AI 回填（mock）：
  - 写入后 `analysisStatus=pending_analysis`
  - Worker 回填为 `ready`（或覆盖一次 `failed` 路径）
  - 产生 SSE invalidation：`argument_updated(reason="analysis_done")`

### Suite E — Flow 4：QV setVotes（强幂等 + 不变量 + 限制）

对齐：`docs/core-flows.md#4`、`docs/api-contract.md#3.7`、`docs/database.md#6.3`。

- E1. 输入校验：`targetVotes` 必须整数且 0..10；否则 `400 BAD_REQUEST`。
- E2. 余额不足：`402 INSUFFICIENT_BALANCE`，且 stake/ledger/totals 全部不变。
- E3. 不变量守恒：多轮随机 `setVotes` 后恒有 `balance + totalCostStaked == 100`。
- E4. pruned 限制：`prunedAt != null` 时禁止增票，只允许减票/撤回：
  - 增票 → `409 ARGUMENT_PRUNED_INCREASE_FORBIDDEN`
  - 撤回 → 200 OK 且资金返还
- E5. topic 只读限制：frozen/archived 时禁止增票，允许撤回：
  - 增票 → `409 TOPIC_STATUS_DISALLOWS_WRITE`
  - 撤回 → 200 OK
- E6. 强幂等（关键）：
  - 同 `(pubkey, nonce)` 重放返回**完全一致**的成功响应（5min 内）
  - 5min 后同 nonce 行为必须明确（建议：视为 replay 并拒绝，或重新计算但需文档化并测试）
- E7. SSE invalidation：成功投票/撤回后写入 `argument_updated(reason="new_vote")`。

### Suite F — Flow 5：Pruning + My Activity 找回资金

对齐：`docs/core-flows.md#5`、`docs/api-contract.md#3.9/#3.10`、`docs/roadmap.md` pruning 口径。

- F1. Host pruning 后：
  - 公共读 tree/children 不再返回 pruned
  - `GET /v1/topics/:topicId/stakes/me` 仍返回我在该 argument 的 stake，并带 `argumentPrunedAt`
- F2. 一键撤回路径成立：
  - 对 pruned 的 stake 执行 `setVotes(0)` 允许并成功返还资金
  - 返还后 ledger 与 totals 仍守恒
- F3. `POST /v1/user/batch-balance`：
  - item 级验签（canonical message 等价 `GET /v1/topics/{topicId}/ledger/me` 且空 bodyHash 末尾 `|`）
  - 单项失败不影响其它项：`ok:false` 的 error code 与契约一致

### Suite G — Flow 6：聚类（God View 数据）+ SSE

对齐：`docs/core-flows.md#6`、`docs/api-contract.md#3.11`、`docs/ai-worker.md#5`。

- G1. 聚类输入口径：
  - 仅 embedding 参与；立场分不参与
  - 过滤 pruned + `analysis_status=ready & embedding!=NULL`
- G2. 触发与节流：
  - debounce 5min（同 topic 不并发跑两次）
  - 阈值：`new_arguments>=5` 或 `total_votes_change>=20%`（口径与文档一致）
- G3. 覆盖写幂等：重复聚类不会造成 camps/cluster_data 膨胀（latest 覆盖）。
- G4. `GET /v1/topics/:topicId/cluster-map`：
  - x/y 归一化到 [-1,1]
  - `clusterId=-1` 表示噪声点
  - `weight=log(totalVotes+1)`
- G5. SSE：聚类后发 `cluster_updated` invalidation。

### Suite W — Web 端到端验收（可选，但推荐）

> 若“最终验收”包含 UI 演示，建议在服务器验收机用 Playwright 做最小 E2E（避免仅 API 通过但页面不可用）。
>
> 对齐：`docs/roadmap.md` M3/M4/M6/M7、`docs/design.md`（视觉原则）、`docs/core-flows.md`。

- W1. Topic 列表与创建
  - 能创建 topic 并在列表出现（契约字段正确）
  - 创建后跳转到详情页（URL 含 topicId）
- W2. Focus View + Dialogue Stream
  - 首屏加载 tree(depth=3)
  - 点击节点加载 children；“最新/最热”切换与分页可用
- W3. 发言 + 投票 + SSE 同步（两窗口）
  - 窗口 A 发言/投票后，窗口 B 在秒级更新（无手动刷新）
  - 收到 `reload_required` 时按约定全量刷新/提示
- W4. 身份系统（M4）
  - 生成/导入助记词后派生 topic 身份稳定（同 topic pubkey 不变）
  - 清空本地后可恢复同一 pubkey（同 topic）
- W5. “我的 / My Activity”
  - 展示参与过的 topics 与余额（batch-balance）
  - pruned stake 可见并可一键撤回（资金返还）
- W6. God View（M6）
  - 能拉取并渲染 cluster-map（空/错误有降级提示）
  - stance 与 cluster 的视觉编码不冲突（见 `docs/prd.md`/`docs/design.md`）

## 5. SSE 专项测试清单

对齐：`docs/api-contract.md#3.12`。

- 事件内容：只允许 invalidation（`id + reason`），禁止携带私密数据（例如 ledger/stakes 明细）。
- `Last-Event-ID`：
  - 不带：按约定从最新/或从头（需固化一种语义并测试）
  - 带：能补发 lastId 之后事件
  - 过旧：发送 `reload_required`
- Stream 裁剪：`MAXLEN ~ 1000` 生效，且不会导致 API 进程 OOM。

## 6. 安全与隐私测试清单（MVP 底线）

### 6.1 鉴权/签名

- raw body hash：服务端必须基于“原始请求体 bytes”计算 `BODY_HASH`（不能 parse 后 re-stringify）。
- PATH：canonical message 的 PATH 不含 query string（严格按契约）。
- timestamp window：`abs(now - ts) < 60s`。
- nonce 去重：同 nonce 在 TTL 内重放 → `409 NONCE_REPLAY`（除 setVotes 命中幂等缓存的情况）。

### 6.2 权限

- Host-only commands：非 owner 永远 `403 NOT_TOPIC_OWNER`。
- pruned/只读限制：只禁止“增票/新增”，不阻断“撤回找回资金”。

### 6.3 数据泄露与匿名性边界

- API 响应/日志不得出现 masterSeed/mnemonic/私钥材料。
- 后端不建立跨 Topic 的用户关联：契约与 DB 设计中不出现全局 userId；验收时做静态检查（schema/迁移）与黑盒响应检查（不返回可关联字段）。

## 7. 性能与并发（建议基线）

> 阈值需团队根据机器规格定义；这里先给“要测什么”。

- 并发 `setVotes`：
  - 同一 pubkey 对同一 topic 多请求：事务不死锁、最终守恒
  - 多 pubkey 并发：P95 延迟与错误率可接受
- SSE 连接数：持续连接 N 分钟不泄漏内存；断线重连可续传。
- Worker：
  - 任务重试不造成数据膨胀
  - 长任务（聚类）不会阻塞 argument-analysis 队列（需要队列隔离与限流策略）

## 8. 发布门禁（Go/No-Go Checklist）

服务器验收通过的最小门槛：

- [ ] `smoke` 全绿（含健康检查、DB/Redis 连接、migrations）
- [ ] Flow 1~4 全绿（Topic 创建/认领、读路径、发言、投票幂等与不变量）
- [ ] pruning + 资金找回路径成立（Flow 5 的关键子集）
- [ ] SSE 可用且仅推 invalidation（含续传/过旧降级）
- [ ] AI/Worker 在 mock 模式下闭环（pending → ready/failed + invalidation）
- [ ] 关键错误码与响应结构稳定（契约 parse 全通过）

可后置但需要记录风险：

- God View 聚类（Flow 6）
- 共识报告（v1.1）
- 风控增强（v1.2）

## 9. 手动验收（视觉/交互，最小清单）

> 只覆盖“契约没法自动保证”的部分，视觉原则以 `docs/design.md` 为准。

- Focus View
  - 连接线为直角折线（不使用曲线），支持渐进式披露（见 `docs/prd.md`）
  - `pending_analysis` 节点有明确降级样式；`ready/failed` 状态可区分（见 `docs/ai-worker.md`）
- Calling Card（Hover）
  - 信息卡为厚描边 + 偏移投影 + 轻微不规则裁切（禁止玻璃风）
  - 内容包含原文片段/票数等关键数值（见 `docs/prd.md`）
- 立场编码（Stance）
  - 支持=Electric，反对=RebelRed，中立=Acid；描边与连线统一 Ink（见 `docs/design.md`）
  - stance 仅影响样式，不改变聚类输入（见 `docs/prd.md`/`docs/ai-worker.md`）
