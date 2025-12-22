# EpiphanyV2 — 强 Persona5 风格 UX/UI 规划（Web）

目标：把现有 `apps/web` 的“功能已通、视觉偏中性”升级为 **强 Persona5（P5）** 的统一体验；同时严格遵守 `docs/stage01/api-contract.md` / `packages/shared-contracts` / `PROJECT_REFERENCE.md` 的稳定边界，避免 UI 重构破坏签名、幂等、SSE 与资金不变量。

适用范围：仅 Web（`apps/web`）。API/Worker 行为以契约为准，不在本规划里改动。

---

## 0) 设计北极星（Persona5 强风格）

来源：`docs/stage01/design.md`（必须遵守）

**核心语法（必须一直成立）**

- **厚 Ink 描边是骨架**：交互元素/卡片/模块边框统一 `4–5px` `Ink`。
- **偏移硬阴影**：优先 `offset shadow`（非玻璃拟态、非柔和 blur）。
- **斜切、轻微旋转、拼贴层次**：允许 ±0.5°~2°，但以可读性为底线。
- **红是主旋律**：`RebelRed` 做“主 CTA / 强警告 / con 立场”；其它高饱和色做语义，不抢主色。
- **材质可感知**：噪点/半调网点/纸张纹理；避免纯平白卡片堆叠。

**不做**

- 不做低对比中性 UI、1px 边框、轻阴影灰白卡片堆叠
- 不做大面积玻璃拟态/柔和渐变

---

## 1) 信息架构（IA）与导航（先定交互，再定样式）

现有页面（App Router）：

- `/topics`：Topic 列表（入口页）
- `/topics/new`：创建 Topic
- `/topics/:topicId`：Topic 详情（Focus / God / Overview + Dialogue Stream）
- `/my`：My Activity

建议导航框架（P5 贴纸式 Header + 二级切换）：

- 顶部常驻导航条（全站一致）：
  - 左：Logo/产品名（Calling Card 风格）
  - 中：当前位置（Topics / Topic / My）
  - 右：Identity 状态（未设置/已设置指纹）、Balance（topic 内）、快捷入口（My）
- Topic 详情页内二级切换：
  - ViewMode：Focus / Overview(Sunburst) / God View
  - 右侧面板：Dialogue（随选中节点变化）

---

## 2) 关键用户旅程（把“复杂”收敛到 6 条主流程）

### Flow A：Topics 列表 → 进入 Topic

- 目标：快速发现/进入讨论；错误可恢复
- 状态：loading / empty / error
- 视觉：列表项做成“贴纸条目”，可显示 status（active/frozen/archived）标签

### Flow B：创建 Topic（不签名）→（可选）认领 Owner

- 创建：`POST /v1/topics` 返回 `{ topicId, claimToken, expiresAt }`
- 当前实现只跳转 topic；规划补齐“可选 Owner 认领”体验：
  - 设计：创建后在成功页/Toast 提示“5 分钟内可认领 Host”
  - 建议（实现策略）：把 `claimToken` 按 topicId 存本地（仅本机可见），等 identity setup 后可一键发 `CLAIM_OWNER`（需 `X-Claim-Token` header）

### Flow C：Topic 详情（读路径）→ 选节点 → 看回复（Dialogue）

- tree 首屏：`GET /v1/topics/:topicId/tree?depth=3`
- children：`GET /v1/arguments/:argumentId/children?...`
- 交互：左侧 Focus 选中节点 → 右侧 Dialogue Stream 切换内容

### Flow D：发言（写）与投票/撤回（写，强幂等）

- 发言：`POST /v1/topics/:topicId/arguments`（签名）
- 投票：`POST /v1/arguments/:argumentId/votes`（签名 + 强幂等）
- 关键状态：
  - `402 INSUFFICIENT_BALANCE`：必须有强提示 + 引导撤回/查看 My
  - `409 TOPIC_STATUS_DISALLOWS_WRITE` / `ARGUMENT_PRUNED_INCREASE_FORBIDDEN`：UI 必须体现“只可撤回”
  - `401 INVALID_SIGNATURE` / `TIMESTAMP_OUT_OF_RANGE`：提示刷新或重建 identity

### Flow E：Owner 管理（Host Deck）

- 入口：仅当 `topic.ownerPubkey === identityPubkey` 才显示
- 功能：freeze/archive/edit root/prune/unprune/generate report
- 交互：所有 destructive 行为需要确认（P5 风格“红色警戒条 + 硬确认”）

### Flow F：My Activity（本地聚合）

- visited topics：localStorage 列表 → `POST /v1/user/batch-balance` 拉余额
- 选中 topic：`GET /v1/topics/:topicId/stakes/me` → 一键撤回（批量 `setVotes(0)`）
- 交互：进度条/失败重试（已有逻辑），需要更强 UI 反馈（成功/失败清单）

---

## 3) 状态矩阵（UI 设计必须覆盖的“复杂点”）

### Topic 状态对交互的影响（稳定语义）

- `active`：允许发言、允许增加/减少投票
- `frozen` / `archived`：禁止发言、禁止“增加”，允许撤回（减少到 0）

### Argument pruning 语义（稳定语义）

- pruned 节点：公共读默认不返回；但若 UI 通过其它路径拿到其 id：
  - 允许撤回（减少投票）
  - 禁止增加

### SSE（只做 invalidation）

- 正常：收到事件 → 去抖刷新（3s）
- `reload_required(trimmed)`：展示常驻 Banner + “Refresh” CTA

### 错误码与 UI 呈现（建议）

- `INSUFFICIENT_BALANCE`（402）：红色告警 + 展示当前余额 + 提供“去 My 撤回”入口
- `INVALID_SIGNATURE` / `TIMESTAMP_OUT_OF_RANGE`（401）：提示刷新；若仍失败，提示重新导入/生成 mnemonic
- `NONCE_REPLAY`（409）：提示“请求已处理/请重试”，避免用户误以为失败
- `RATE_LIMITED`（429）：提示“操作太频繁”+ 倒计时（读取 `Retry-After` 若存在）
- `TOPIC_PUBKEY_BLACKLISTED`（403）：提示“你在该 topic 被禁用写入”，仍允许只读

---

## 4) 组件体系（先做 UI primitives，再做页面）

目标：把所有页面从“零散 Tailwind 拼装”收敛到一套 P5 primitives，确保：

- 统一描边/阴影/斜切/材质
- 统一交互反馈（hover/pressed/focus/disabled/loading）
- 统一错误态/空态/骨架屏

### 建议的 primitives（最小集）

> 建议放在 `apps/web/components/ui/*`，并用 `P5` 前缀区分语义层组件。

- `P5Shell`：全站背景材质 + 版心 + 顶部导航框架
- `P5Card` / `P5Panel`：基础容器（Ink 边 + 偏移影 + 轻微 skew）
- `P5SectionTitle`：Calling Card 风格标题条（可复用现有 `CallingCard` 语言）
- `P5Button`：`primary(rebel) / ink / ghost / danger`
- `P5Tabs`：ViewMode 切换（厚边、选中强对比）
- `P5Input` / `P5Textarea`：输入组件（focus 强反馈）
- `P5Slider`：投票 slider（0..10 step=1），显示 `cost` 与 `Δcost`
- `P5Badge`：状态/立场标签（TopicStatus、stance）
- `P5Alert`：error/warn/info（替换 scattered 的 `role="alert"` div，但保留语义）
- `P5Modal`：管理/报告/identity（可参考现有 `ConsensusReportModal` 的粗边+硬影）
- `P5Tooltip`：用于 GodView/Sunburst/Focus hover（可直接复用/扩展 `CallingCard`）
- `P5Skeleton` / `P5EmptyState`：loading/empty 统一组件

### 页面级组件（现有组件建议“保留功能，换皮肤”）

- `TopicList` / `CreateTopicForm`
- `TopicPage`（编排层：不重写业务）
- `FocusView` / `DialogueStream` / `GodView` / `SunburstView`
- `IdentityOnboarding` / `TopicManagePanel` / `ConsensusReportModal` / `MyActivity`

---

## 5) 视觉 tokens 与落地方式（Tailwind v4 + CSS Variables）

现状：`apps/web/app/globals.css` 已包含 `--ink/--paper/--rebel-red/...` 等 token。

建议补齐的 tokens（用于全站一致性，不绑定具体组件）：

- 形状：`--p5-radius-sm`（尽量小）、`--p5-cut`（斜切尺寸）、`--p5-tilt`（默认旋转角）
- 阴影：`--p5-shadow-ink`（已存在）、`--p5-shadow-rebel`（已存在）、`--p5-shadow-acid`（可选）
- 材质：`--p5-noise-opacity`、`--p5-halftone-opacity`（配合背景层实现）
- 文本：`--p5-font-display`（标题窄体）、`--p5-font-body`（正文耐读）、`--p5-font-mono`

实现原则：

- tokens 只在 `globals.css` 定义；组件只引用变量（`var(--ink)` 等），避免硬编码颜色
- 所有“描边宽度、阴影偏移、动画时长”都由 token 管控

---

## 6) 页面线框（Wireframe）与布局建议（强 P5 的“拼贴分区”）

### `/topics`（列表）

- Header：Calling Card 标题条 + 右侧 Create CTA（RebelRed）
- 列表：每行条目是“贴纸”，右侧显示 status badge
- Empty：P5 风格空态（引导创建）

### `/topics/new`（创建）

- 表单做成“印刷表单卡”：Ink 边 + 硬影 + 斜切角
- 提交成功后：Toast/Modal 提示 claimToken 的用途（可选 Owner 认领）

### `/topics/:topicId`（详情：双栏）

左栏（视图区）：

- 顶部：Topic title（大字）+ status badge + identity 指纹 + balance
- ViewMode tabs：Focus / Overview / God View
- 主区：根据 view 渲染（Focus/Sunburst/God）

右栏（Dialogue Deck）：

- 顶部：当前选中节点的 Calling Card（摘要 + authorId + stance/analysis 状态）
- 中部：children 列表（最热/最新 tabs）
- 底部：Reply + Vote（写入口与投票控件）

### `/my`（My Activity）

左：Visited Topics（topicId 列表 + balance + lastInteraction）
右：Selected topic stakes（带 pruned 标记）+ Withdraw All（进度与失败重试）

---

## 7) 动效与反馈（P5 的“硬反馈”）

- hover：轻微位移/旋转（≤ 2°）+ 阴影偏移变化（不要 blur）
- pressed：下压 2px（模拟印刷压痕）
- focus：Ink 描边 + RebelRed 次描边（双层边/双层 shadow）
- error：短促 shake（尊重 `prefers-reduced-motion`）
- loading：Skeleton 用半调网点/斜线纹理，不要纯灰条

---

## 8) 可视化（Focus/God/Sunburst）在 P5 语言下的规则

### FocusView（当前为简化树）

短期（换皮不改结构）：

- 把节点按钮替换为 “Tag + Ink 边 + stance 色条”
- 连接线改为 “Ink 手绘线/虚线” 的视觉

中期（结构升级，可选）：

- 用直角连线布局（对齐 roadmap 的 Focus View 设想），并保留可访问性 fallback（列表）

### GodView（Canvas）

- cluster 区域：用“纸片底色 + Ink 边框 + label 打印字体”
- 点：白点填充 + stance 色描边（已接近）
- Tooltip：统一 CallingCard（目前可以补齐）
- Legend：固定在角落（stance 三色 + cluster 说明）

### Sunburst（SVG）

- 保持 Ink stroke（已存在），tooltip 统一 CallingCard
- 选中态：RebelRed/Ink 双层描边 + “贴纸” label

---

## 9) 实施路径（最小风险、可持续迭代）

### Phase 0（1 天）：视觉基础不改业务

- 完成 `P5Shell`（背景材质、版心、全局排版）
- 统一 `body` 字体与颜色引用 tokens（不引入外部字体也可）

### Phase 1（2–3 天）：primitives 落地

- 实现 `P5Button/P5Card/P5Alert/P5Modal/P5Tabs/P5Input/P5Textarea/P5Slider`
- 替换 `/topics` 与 `/topics/new`，确保测试不回归

### Phase 2（2–4 天）：Topic 详情页“换皮”

- `TopicPage` 头部信息条、ViewMode tabs、右侧 Dialogue Deck 全面 Persona5 化
- `ConsensusReportModal`/`TopicManagePanel` 统一 modal/panel 语言

### Phase 3（2–5 天）：可视化与细节

- GodView tooltip/legend/材质
- FocusView 视觉与层级表达
- My Activity 的“进度/失败重试/撤回”反馈强化

### Phase 4：收口（持续）

- 错误码映射统一（同一种错误在不同页面表现一致）
- 空态/骨架屏一致
- 无障碍与键盘操作回归

---

## 10) 验收与不回归清单（强制）

功能不回归（来自 `PROJECT_REFERENCE.md`）：

- 签名 v1（path 不含 query、raw body hash、nonce 规则）不改坏
- `setVotes` 的“强幂等 + 允许撤回”语义不改坏
- SSE：`reload_required(trimmed)` 必须可恢复（刷新）
- `role="alert"`、`Reply`、`Votes` slider 的可访问性/测试锚点保留（或等价替换）

建议每阶段执行：

- `pnpm -C apps/web test`
- 手动回归：创建 topic → 进入 → 发言 → 投票/撤回 → SSE 刷新 → My withdraw all
