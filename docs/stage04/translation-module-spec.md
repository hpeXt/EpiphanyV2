# Stage04 — 翻译模块（zh/en）设计与落地规格（低预算：¥20/月）

## 1. 目标

- 支持 `zh/en` 两种显示语言（默认 `zh`），切换后**全站内容**随之切换：
  - UI 文案：由前端 i18n 处理（已存在 `epiphany_locale` cookie）
  - 用户内容（UGC）：Topic / Argument / displayName /（report 按需）由后端翻译模块处理
- 缺译文时允许回退原文（不阻塞读写）。
- 允许把用户内容发给第三方模型（OpenRouter）。
- 翻译完成后通过 SSE 自动生效（前端收到事件后自动重新拉取）。
- 预算上限：每月约 `¥20`，需要硬闸门避免超支。

## 2. 范围（首期优先级）

1. `Topic.title`（资源类型：`topic_title`）
2. `Argument.title/body`（资源类型：`argument`）
3. `TopicIdentityProfile.displayName`（资源类型：`topic_profile_display_name`）
4. `ConsensusReport.contentMd`（资源类型：`consensus_report`，按需翻译）

后续可扩展：`camp` 等。

## 3. Locale 约定

- Header：`x-epiphany-locale: zh|en`
- 兜底：`Accept-Language`（简单解析首个 language-range）
- 默认：`zh`

前端使用 `epiphany_locale` cookie 管理 UI 语言，并在请求时同步发送 `x-epiphany-locale`。

## 4. 数据模型（通用翻译表）

仓库已落地一张通用表 `translations`（Postgres + Prisma）：

- 唯一键：`(resource_type, resource_id, target_locale)`
- 关键字段：
  - `status`: `pending | ready | failed | skipped_budget`
  - `source_hash`: 32 bytes（sha256），用于防止“源内容变化导致旧译文覆盖”
  - `data`: JSON（不同资源类型的译文字段）

### 4.1 resourceId 规范

- `topic_title`: `${topicId}`
- `argument`: `${argumentId}`
- `consensus_report`: `${reportId}`
- `topic_profile_display_name`: `${topicId}:${pubkeyHex}`
- `camp`: `${topicId}:${clusterId}`

## 5. 写路径策略（不阻塞，异步入队）

### 5.1 触发点

- 创建 Topic（同时创建 root Argument）
- 编辑 root
- 创建/编辑 Argument
- 设置 displayName

### 5.2 译文方向（关键：不依赖 UI 语言）

写入时对源文本做“免费启发式”语言判断：

- 含 CJK 字符 ⇒ 认为源语言 `zh`
- 否则 ⇒ 认为源语言 `en`

然后仅翻译到**另一种语言**，避免不必要调用：

- `source=zh` ⇒ 生成 `target=en` 译文
- `source=en` ⇒ 生成 `target=zh` 译文

> 这样即使用户在中文 UI 下输入英文，仍会为 `zh` 侧生成译文（反之亦然）。

### 5.3 入队与幂等

- API 写路径会：
  1) upsert `Translation(status=pending, source_hash=sha256(source))`
  2) enqueue BullMQ `ai_translation`（jobId 使用 sha256(key) 保证幂等）
- 翻译任务在 Worker 执行，不阻塞写请求。

## 6. 读路径策略（覆盖 + 回退）

API 返回给前端的字段直接是“显示语言”：

- 若存在 `Translation(status=ready)` 且 `source_hash` 与当前源内容匹配 ⇒ 用译文覆盖
- 否则 ⇒ 回退原文

### 6.1 report 按需翻译

当用户请求 report 且目标语言与报告当前语言不一致、且缺译文时：

- API 仅入队翻译（不阻塞响应）
- 本次仍返回原文
- 译文完成后 SSE 触发前端自动刷新

## 7. Worker 翻译执行

### 7.1 队列

- BullMQ queue: `ai_translation`

### 7.2 模型与 Provider

- Provider：OpenRouter
- 默认模型：`z-ai/glm-4.7`（可用 `TRANSLATION_MODEL` 覆盖）
- 输出格式：严格 JSON（按资源类型固定 schema）
- 关键约束：
  - 保留 Markdown 结构与换行
  - report 必须原样保留 `[S#]` 引用标签

### 7.3 SSE

Worker 写入译文后向 Redis Stream `topic:events:${topicId}` 发布：

```json
{
  "event": "translation_updated",
  "data": {
    "topicId": "...",
    "resourceType": "argument",
    "resourceId": "...",
    "locale": "en"
  }
}
```

前端 Topic SSE hook 已对除 `reload_required` 外的所有事件做 cache invalidation，因此译文自动生效。

## 8. 预算闸门（¥20/月）

### 8.1 为什么需要“硬闸门”

UGC 翻译是不可控成本（尤其是 report），必须在 Worker 层做硬限制，确保不超支。

### 8.2 当前实现（Redis 月度 tokens 计数）

Worker 在调用 OpenRouter 前：

1. 估算本次翻译 token（保守估计：`800 + 2 * 字符数`）
2. Redis key：`translation:budget:YYYY-MM`
3. Lua 原子检查 + `INCRBY`：
   - 超过额度 ⇒ `status=skipped_budget`（回退原文）
   - 未超过 ⇒ 允许调用

### 8.3 配置项（建议）

- `TRANSLATION_BUDGET_TOKENS_PER_MONTH`
  - 默认：`200000`（保守）
  - `0`：完全禁止外部翻译（永远 `skipped_budget`）
  - `-1`：无限制（不推荐）

> 由于 OpenRouter 计费与模型价格可能变化，建议根据实际单价把 `¥20` 换算为 token 上限。

### 8.4 `¥20/月` 大致能翻多少字？

由于不同模型单价差异很大，这里给两种口径：

1) **按 token 上限粗估（与模型价格无关）**  
Worker 的保守估算是 `800 + 2 * 字符数`（含 prompt/输出与安全冗余）。因此：

- `100000 tokens/月` ≈ `~50000` 字符（中文）级别的翻译量（多条内容会被 `800` 的固定开销吃掉一部分）
- `200000 tokens/月` ≈ `~100000` 字符（中文）级别的翻译量

典型条目估算（保守）：

- Topic 标题（30 字）：`~860 tokens`
- displayName（12 字）：`~824 tokens`
- Argument（600 字）：`~2000 tokens`
- Report（8000 字）：`~16800 tokens`

2) **按 `¥20` 换算 token（需要你填“单价”）**  
如果你知道模型“总 token（input+output）”的单价为 `P USD / 1M tokens`，可用：

`tokensBudget ≈ floor((20 / 7.2) / P * 1_000_000 * 0.8)`（`0.8` 为安全系数，避免超支）

## 9. 未来扩展

- 增加更多内容类型（Camp / report meta / bodyRich）
- 引入更精细的优先级（当前视图内优先、按票数优先）
- 更精确的 token/费用核算（使用 OpenRouter usage + 单价配置）
- 前端显示“正在翻译/预算不足”等提示（当前不强依赖）

## 10. 最小配置与验收

- `.env` 至少需要：
  - `OPENROUTER_API_KEY`
  - `TRANSLATION_PROVIDER=openrouter`
  - `TRANSLATION_MODEL=z-ai/glm-4.7`（或留空走默认）
  - `TRANSLATION_BUDGET_TOKENS_PER_MONTH=200000`（按预算调整）
- 验收路径：
  - 创建/编辑 Topic、Argument、displayName 后，Worker 能消费 `ai_translation` 队列并写入 `translations`
  - 前端切换语言后，API 返回对应语言（缺译文回退原文）
  - 翻译完成后 SSE `translation_updated` 触发页面自动刷新（无手动刷新）
