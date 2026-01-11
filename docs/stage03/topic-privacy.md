# Stage03 — Topic Privacy 设计（Unlisted + Private + Participants）

本文档提出一个**可落地、与当前匿名身份体系兼容**的 Topic 隐私方案，使议题满足：

- **只有拥有链接的人可见**（“链接”携带能力密钥 / capability secret）
- **或曾参与的人可见**（参与=在该 Topic 内产生过写入/投票等账本痕迹）

并且保持 Stage01 的硬约束：

- **后端不建立跨 Topic 的用户关联**（同一设备/用户在不同 Topic 使用不同 pubkey）。

---

## 0. 背景（当前系统的真实隐私边界）

当前 `EpiphanyV2` 的“隐私”主要是 **Topic 级不可关联的匿名身份**（见 `docs/stage01/crypto.md`），但 **Topic 内容本身是公开可读**：

- `GET /v1/topics`（公开列出 topics）
- `GET /v1/topics/:topicId/tree`、`GET /v1/arguments/:argumentId`、`GET /v1/arguments/:argumentId/children`（公开读）
- SSE `GET /v1/sse/:topicId` 也公开（仅推 invalidation，但仍泄露“存在+活跃”）

因此“只有拥有链接的人才可见”在当前实现中**不成立**：不需要链接密钥也能通过 list/tree 等读到内容。

本设计把“隐私”明确为 **访问控制隐私（Access Control Privacy）**：

- 目标是“未经授权的人拿不到内容”
- **非端到端加密（E2EE）**：服务端/DB/Worker 仍可看到明文（AI 分析、聚类、报告等依赖明文）

如需更强的“服务端不可读”隐私，见本文最后的可选扩展。

---

## 1. 目标与非目标

### 1.1 目标

1. **三档可见性**：`public / unlisted / private`。
2. `unlisted`：不出现在公共列表；但拥有 topic 链接（topicId）即可访问。
3. `private`：不出现在公共列表；必须满足以下之一才可读：
   - **持有链接密钥**（capability secret）
   - **已参与该 topic 的身份**（同 topic pubkey，服务端可验证“曾参与”）
4. 不引入“全局账号体系”、不破坏现有签名 v1 与 Topic 级身份派生。
5. 尽量降低 URL 泄密风险（避免把长期密钥放进 query/path）。

### 1.2 非目标（本阶段不做）

- 端到端加密（服务端不可读）
- 完全隐匿 topic 存在性（可做到“未授权返回 404”，但无法消除 IP/时序侧信道）
- 可发现的“我的私密 topics 列表”（依旧坚持客户端聚合；服务器不提供跨 topic 的 user dashboard）

---

## 2. 术语

- **TopicVisibility**：
  - `public`：公开、可被列表发现
  - `unlisted`：不在列表；知道 topicId 即可访问
  - `private`：不在列表；需要访问凭证（密钥或参与证明）

- **Topic Access Key（TAK）**：用于 `private` 的高熵随机密钥（推荐 32 bytes）。
  - 作为“能力链接”的秘密部分：拥有 TAK ≈ 拥有阅读权限
  - 服务端只存 **hash**（不可逆），不存明文

- **参与者（Participant）**：在该 topic 内出现过“写入/投票”的 pubkey。
  - 推荐以 `ledger(topicId, pubkey)` 是否存在作为参与判定（已经落库，且与匿名体系一致）
  - `ownerPubkey`（Host）永远视为参与者

- **SSE Ticket（可选）**：给 EventSource 用的短期一次性票据（因为 EventSource 不能带签名 header）。

---

## 3. 方案选择（为什么是“能力链接 + 参与者兜底”）

我们评估四类常见方案：

1. **仅 unlisted（不进列表）**  
   - 优点：实现最简单  
   - 缺点：不是“真正隐私”，只靠“不被列出”和 topicId 难猜；一旦 topicId 泄露即全公开

2. **纯 ACL（只允许参与者/受邀 pubkey）**  
   - 优点：访问控制清晰  
   - 缺点：在本项目“无账号、无全局身份”的前提下，首次受邀/加入流程复杂；也无法支持“无身份的只读访问”

3. **能力链接（capability URL / secret）** ✅（推荐主方案）  
   - 优点：符合“只有拥有链接的人可见”，分享成本低；不需要先建账号  
   - 缺点：密钥泄露即共享失控；对“按人撤销”无能为力

4. **端到端加密（E2EE）**  
   - 优点：最强隐私（服务端也不可读）  
   - 缺点：与当前 AI/聚类/报告冲突；需要全新密钥与渲染链路

因此本设计采用 **方案 3（能力链接）**，并补上 **“参与者兜底”**：

- 私密 topic 的首次进入靠 TAK（符合“拥有链接的人可见”）
- 一旦产生参与痕迹（ledger），未来即使 TAK 丢失/被轮换，参与者仍可凭签名访问（符合“参与的人可见”）

---

## 4. 数据模型（DB）

以 `packages/database/prisma/schema.prisma` 为基准，建议新增：

### 4.1 topics 表新增字段

- `visibility`：`topic_visibility` enum，默认 `public`
- `access_key_hash`：`ByteA?`（nullable；仅 `private` 有值）
- `access_key_rotated_at`：`Timestamptz?`（可选，审计/调试用）

示例（概念，非 Prisma 语法）：

- `Topic.visibility: topic_visibility @default(public)`
- `Topic.accessKeyHash: Bytes? @map("access_key_hash")`

> 为什么存 hash：DB 泄露时避免直接暴露 TAK；且 TAK 本身应为 256-bit 随机，hash 抗离线穷举。

### 4.2 “参与者”不新增表（建议 v1）

参与者判定：复用现有 `Ledger(topicId, pubkey)` 是否存在。

- 创建 argument 时已 `ledger.upsert(...)`
- 投票时也会创建/更新 ledger
- 因此“参与”天然可被验证，且不会引入跨 topic 关联

如未来需要“只读受邀成员 / 手动踢出成员”，再引入 `topic_members` 表（见 §9.2）。

---

## 5. API 与鉴权策略（建议 v1.1 扩展）

### 5.1 TopicSummary 增字段

`TopicSummary` 建议新增：

- `visibility: "public" | "unlisted" | "private"`

并在 `GET /v1/topics/:topicId/tree` 的响应中返回该字段（便于前端决定是否需要 TAK/签名读取）。

### 5.2 Create Topic：支持创建 unlisted/private（可选）

`POST /v1/topics`（当前无签名）可以扩展为：

- request：增加可选 `visibility`
- response：若 `visibility="private"`，额外返回一次性的 `accessKey`（明文，只返回一次）

也可保持 createTopic 不变，通过 Host command 来切换隐私（见下）。

### 5.3 Host commands：设置可见性与轮换密钥

在 `POST /v1/topics/:topicId/commands` 增加两类命令：

- `SET_VISIBILITY { visibility }`（owner-only）
  - `public → unlisted/private`
  - `private → public/unlisted`（清空 access_key_hash）
- `ROTATE_ACCESS_KEY {}`（owner-only，仅 private）
  - 生成新 TAK，写入新 hash，并返回新 `accessKey`（明文只在响应返回一次）

> 轮换语义：旧链接立即失效；参与者兜底仍可访问（因为参与判定不依赖 TAK）。

### 5.4 读接口的访问控制规则（核心）

对以下读接口引入“按 topic.visibility 分流”的访问控制：

- `GET /v1/topics/:topicId/tree`
- `GET /v1/arguments/:argumentId`
- `GET /v1/arguments/:argumentId/children`
- `GET /v1/topics/:topicId/cluster-map`
- `GET /v1/topics/:topicId/consensus-report/latest`
- `GET /v1/sse/:topicId`（见 5.6）

规则：

| visibility | listTopics | tree/argument/children | 备注 |
|---|---|---|---|
| public | ✅返回 | ✅公开读 | 现状 |
| unlisted | ❌不返回 | ✅公开读 | “拿到 topicId 即可读” |
| private | ❌不返回 | ✅需授权 | TAK 或参与者 |

**private 的授权方式（两种任一满足即可）**：

1. **TAK 授权**：请求携带 `X-Topic-Access-Key: <hex>`（推荐）  
   - 服务端做 `sha256(keyBytes)` 对比 `access_key_hash`
2. **参与者授权**：请求携带 v1 签名 headers（`X-Pubkey/X-Signature/...`）  
   - 验签通过后，检查：
     - `topic.ownerPubkey == pubkey` ✅
     - 或 `ledger(topicId, pubkey)` 存在 ✅

> 返回码建议：为减少“探测 topic 是否存在”的信息泄露，未授权时可统一返回 `404 TOPIC_NOT_FOUND/ARGUMENT_NOT_FOUND`（而不是 403）。

### 5.5 写接口的访问控制（private 的首次参与）

写接口本身已 RequireSignature，但对 `private` topic 需要额外 gate：

- 若 pubkey 已是参与者（ledger 存在或 owner）→ ✅允许
- 否则必须提供 TAK（`X-Topic-Access-Key`）→ ✅允许首次写入并创建 ledger

涉及写接口：

- `POST /v1/topics/:topicId/arguments`
- `POST /v1/arguments/:argumentId/votes`
- `POST /v1/arguments/:argumentId/edit`
- `POST /v1/topics/:topicId/commands`（host-only，host 本身天然满足参与者条件）

### 5.6 SSE 的私密化（EventSource 限制）

问题：浏览器原生 `EventSource` **不能自定义 headers**，因此无法直接走签名 v1。

建议分两条通路：

1. **TAK 直连**（给“拥有链接的人”）：  
   - `GET /v1/sse/:topicId?k=<accessKey>`（仅用于 SSE，短期可接受 query；长期建议用 ticket）
2. **SSE Ticket（可选，给“参与者兜底”）**：  
   - `POST /v1/topics/:topicId/sse-ticket`（RequireSignature + 参与者校验）→ 返回 `{ ticket, expiresAt }`
   - EventSource 连接：`GET /v1/sse/:topicId?ticket=...`
   - ticket 存 Redis（TTL 60s）；只在**建立连接时**校验，断线重连需重新申请

> SSE payload 仍必须只包含 invalidation（`id + reason`），避免在私密 topic 中通过 SSE 泄露正文。

---

## 6. Web 前端交互与密钥存储

### 6.1 分享链接格式（避免 query 泄密）

推荐把 TAK 放在 URL fragment（不会被浏览器发给服务器，也更不易进日志/referrer）：

- `https://<web>/topics/<topicId>#k=<accessKeyHex>`

前端行为：

1. 进入 topic 页面时读取 `location.hash` 提取 `k`
2. 写入本地：`localStorage["tm:topic-access-key:v1:<topicId>"] = <hex>`
3. 后续 API 请求通过 header `X-Topic-Access-Key` 携带（GET/POST 通用）

### 6.2 无身份的只读体验

若用户尚未生成身份（本地无 master seed）：

- `public/unlisted`：可直接读
- `private`：只要有 TAK（来自链接 fragment）即可读
- 但写/投票仍要求签名（需要生成身份）

### 6.3 Host 的隐私控制入口（建议）

在现有 Host 管理面板中增加：

- 当前 visibility 状态展示
- 切换为 `unlisted/private/public`
- `private` 下提供“复制分享链接（含 fragment key）”
- “轮换链接密钥”（提示：会使旧链接失效）

---

## 7. 安全与隐私分析（Threat Model）

### 7.1 能抵御的威胁

- **列表枚举**：private/unlisted 不在 `GET /v1/topics` 返回
- **无授权访问**：private 的 tree/argument/children/cluster/report/SSE 都无法读到内容
- **DB 泄露直接拿 key**：只存 hash，不存明文 TAK

### 7.2 仍存在的边界（必须明确）

- **密钥泄露**：TAK 是 bearer secret；任何持有者都可读取（无法区分“谁”）
- **侧信道**：IP/时序/流量仍可能做弱关联（与 Stage01 既有边界一致）
- **截图/转发**：用户可二次传播内容（任何访问控制都无法阻止）

### 7.3 外部模型（关键现实约束）

本项目的 AI（含共识报告/立场分析/embedding 等）如果**必须使用外部模型**，则必须把“隐私”定义为：

- **对产品内未授权用户不可见**（Access Control）
- 但 **对外部 AI Provider 并不保密**（内容会出境/出域，Provider 可见明文）

这不是实现细节，而是**信任边界**。即使 Topic 为 `private`：

- UI/接口能阻止未授权用户读取 topic/report
- 但 Worker 生成 report 时会把选中的文本发送给 Provider（否则无法生成）

因此必须补齐两类措施：

1) **产品层明确告知/同意**
- 在 Host 的隐私设置与 “Generate report” 按钮旁提示：会把该 Topic 的部分内容发送到外部 AI 服务用于生成报告（建议提供开关/二次确认）。

2) **数据最小化 + 去标识**
- Prompt/请求中不要发送：`topicId/argumentId/pubkey/authorId`、内部 URL、任何可用于跨系统关联的稳定标识。
- 在保证“去标识”的前提下，**报告若要求足够详细**，就必须发送足够多的原文内容：
  - 默认发送选中 arguments 的完整正文（必要时分片/多轮调用以适配模型上下文窗口）。
  - 输入选择策略仍然需要固定且可解释（例如 root + Top N，过滤 pruned；或按 cluster/权重做采样），避免 Topic 很大时无限膨胀。
- Worker/API 日志不要记录正文（只记录 hash/长度/计数），避免二次泄露。

3) **来源溯源（让读者能回到原文，但不把内部 ID 给 Provider）**
- 如果报告需要展示“观点来源”，并能追溯到原始 `authorId` / `argumentId`（同一个 topic 下 `topicId` 恒定）：
  - **对外部模型输入**：用临时标签（如 `S1..Sn`）标注每条输入观点，要求模型在输出中以 `[S3]` 这类方式引用来源。
  - **对产品内展示**：Worker 在 `consensus_reports.params`/`metadata` 存 `S* → { argumentId, authorId }` 映射；Web 渲染时把 `[S3]` 展示为可点击的来源链接（或在末尾生成 Sources 列表）。
- 这样可以同时满足：报告详细 + 有来源 + 外部模型看不到我们内部的稳定标识。

### 7.4 关键建议

- 默认在 Web 设置安全头：`Referrer-Policy: no-referrer`（避免把带 token 的 URL 外泄）
- 对 `private` 未授权统一返回 404（降低可探测性）
- 风控：对私密读（带错 key 的重试）按 IP 做限流，避免在线穷举

---

## 8. 兼容性与迁移

- DB migration：新增字段默认 `public`，不影响现有 topics
- API：`TopicSummary.visibility` 是向后兼容字段；旧前端忽略也不影响 public topic
- 旧前端访问 private topic 会失败（预期），需要给出明确 UX（“需要链接密钥/你无权限”）

---

## 9. 可选扩展（更“强”的隐私）

### 9.1 端到端加密（E2EE）模式（与 AI 功能互斥）

如果未来要支持“服务端不可读”：

- 用 TAK 派生对称密钥（例如 `HKDF-SHA256(TAK, "topic-content-v1")`）
- 客户端加密 `title/body/bodyRich` 后再上传（服务端仅存 ciphertext）
- 代价：
  - AI embedding/stance/cluster/report 无法在服务端生成（除非引入客户端 AI 或可信执行环境）
  - 搜索、审核、反垃圾能力下降

建议作为独立产品模式，而不是默认。

### 9.2 显式成员表（可踢人/只读邀请）

若需要“按人撤销阅读权限”：

- 新增 `topic_members(topicId, pubkey, role, createdAt, removedAt?)`
- private read 不再接受 TAK 直接读（或仅接受一次性 invite token），统一以成员为准
- 这会改变“拥有链接即可读”的产品语义，需要重新确认需求
