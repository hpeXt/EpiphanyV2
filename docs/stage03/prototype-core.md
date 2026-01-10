# Epiphany — Prototype Core（Interaction + Product Logic）

本文件把 `apps/web/epiphany-v2-prototype` 的**交互逻辑（Interaction）**与**产品思维（Product Logic）**抽取为“新应用核心”，用于指导 `apps/web` 的新前端重构（旧 UI/模块不作为约束）。

> 目标不是复刻 UI 细节，而是复刻：用户如何进入、如何探索、如何读、如何投票、如何贡献、主持人如何治理、AI 如何提供“阶段性结论”。

---

## 0. 原型的北极星（North Star）

- **Topic 是主舞台**：绝大多数用户通过分享链接直接进入 Topic 详情页；列表页只是轻量入口/创建工具。
- **“地图优先 + 阅读优先”**：Sunburst 是讨论的“地图”；右侧是可沉浸阅读的“文章视图”。
- **界面隐形，内容显形**：Headerless / White-label；控件只在需要时出现，且出现在“语义位置”。
- **分层信息披露**：Hover 预览（轻）→ Click 聚焦（重）；进入阅读态后减少干扰（隐藏 hover card）。

---

## 1. 领域对象与映射（Prototype → 新应用）

原型概念与新应用（`apps/web` + `/v1` 契约）的一一映射：

- `Topic` → `Topic`（讨论主题）
- `Viewpoint`（树结构帖子）→ `Argument`（树结构论点节点）
- `Vote (QV)` → `setVotes(targetVotes)`（0..10，成本 = votes²）
- `Credits`（用户剩余票力）→ `LedgerMe.balance`（剩余预算，初始 100）
- `totalVotes` → `Argument.totalVotes`（节点热度/权重）
- `AI Report` → `/v1/topics/:topicId/consensus-report/latest` + 生成入口（Owner）
- `Host`（topic creator）→ `ownerPubkey` 对应的当前身份（本地派生 pubkey）

> 注：原型里有 `themeMode`/`theme`（主持人主题分组）。新应用目前契约没有“主题”字段，先把它视为 **可扩展的“主持人标注/分组能力”**（后续可用 cluster label、或新增字段落库 + 契约升级）。

---

## 2. 产品逻辑（Product Logic）

### 2.1 入口与信息架构（IA）

- **去中心入口**：Topic 详情页是 standalone destination；不依赖首页导航。
- **列表页定位**：只做「发现/创建/最近参与」；不做复杂 dashboard。

### 2.2 探索与阅读的角色分离

- **探索（Explore）**：通过 Sunburst 以“结构+热度”理解全局。
- **阅读（Read）**：选中节点后进入文章式阅读；讨论与操作贴近内容末尾。

### 2.3 贡献机制（Write）

- **低摩擦发布**：
  - 不要求单独标题输入；标题可由正文首句/摘要自动生成（原型如此）。
  - 编辑器默认“干净写作”模式（可隐藏工具栏）。
- **语义位置发布**：默认回复发在当前阅读节点之下；未选中时默认发在 root 节点下（“公开提出新观点”）。

### 2.4 二次方投票（QV）

- **强可见的成本模型**：投票 UI 必须同时展示 `votes` 与 `cost=votes²`。
- **可逆调整**：允许提高或撤回（降低 votes），并即时展示 Δcost/剩余预算变化。
- **限制语义**：
  - topic 非 active 或节点 pruned：**禁止增加**，允许减少/撤回。
  - 预算不足：禁止增加（前端可做预判，后端做最终裁决）。

### 2.5 主持人治理（Host curation）

- **主持人有“结构呈现权”**：
  - 原型：主题分组开关（themeMode）由 host 决定，所有用户看到同一呈现方式。
  - 新应用：同等地位的能力可以是「视图模式/过滤/隐藏」等，但必须由 host 控制并可被解释。

### 2.6 AI 作为“阶段性总结”，不是对话助手

- **AI 报告是 artifact**：用户主动查看；报告包含生成时间、覆盖范围（节点数/总票数）。
- **报告生成是治理动作**：可由 host 触发（原型如此）；其他人只读。

---

## 3. 交互逻辑（Interaction Model）

### 3.1 页面状态机（推荐）

核心状态：

- `Explore`：未选中节点（selected=null）
- `Read`：选中节点（selected=argumentId）
- `Compose`：在 Read 或 Explore 下打开编辑区（输入中）
- `Synthesize`：AI Report Modal 打开

关键原则：**从 Explore → Read 是“加深”，从 Read → Explore 是“退回全局”。**

### 3.2 动态双栏（Hover-to-resize）

原型的“意图推断”规则（可迁移）：

- 未选中节点时，根据鼠标在容器内的水平位置推断用户意图：
  - 靠左：更偏探索 → 左栏扩展
  - 靠右：更偏阅读 → 右栏扩展（左栏收缩）
  - 中间：恢复默认
- 选中节点后：**锁定布局**（左栏变窄，给阅读内容让位），避免持续抖动。

### 3.3 Sunburst 交互（Map）

- **Hover**：显示“预览卡”（标题 + 摘要 + 票数/作者），不改变选择。
- **Click**：选中节点进入 Read；同时清空/重置投票输入状态。
- **Click 空白**：取消选中回到 Explore（回到“全局地图”）。
- **进入 Read 后**：隐藏 hover card（减少干扰）。

### 3.4 阅读区交互（Article）

- **Header**：标题 + 作者（匿名标识）+ 日期 +（可选标签）。
- **正文**：长文阅读排版（prose/行高/边距）优先于卡片式密集布局。
- **操作靠近内容末尾**：
  - 投票组件放在底部（读完再投，强调“思考后行动”）。
  - 回复编辑器在投票之后（先表态，再补充论证）。

### 3.5 白标与品牌呈现

- 无全局 header；仅保留：
  - 左下角 “Hosted by Epiphany” 弱化链接
  - 未登录/无身份时，右下角/底部提供“参与讨论”的入口

---

## 4. 落地到 `apps/web` 的实现要点（作为开发约束）

### 4.1 不变量（必须保持）

- `/v1` 契约与签名逻辑不变（见 `PROJECT_REFERENCE.md`）。
- QV：`0..10`，`cost=votes²`，topic 非 active 或 pruned 禁止增加。
- SSE 只做 invalidation；UI 收到后自行 re-fetch（不要改成推全量）。

### 4.2 新 UI 的“核心组件”建议（参考落点）

- `TopicStage`（页面编排：状态机 + 动态双栏）
- `SunburstExplorer`（hover card + click select + 空白回退）
- `ArgumentReader`（文章式阅读 + 底部投票 + 底部回复）
- `VoteStepper`（± 控制 + cost/Δcost/余额提示）
- `ReportModal`（只读 + host 触发生成）

---

## 5. 需要你确认的产品取舍（下一步）

1. **是否把 Sunburst 设为唯一主视图**（原型逻辑），还是保留 Focus/God View 作为二级入口？
2. **主题分组（themeMode）在新应用的等价物是什么**：host 标签？cluster label？还是先不做？
3. **投票 UI**：沿用原型的“± + 确认投票”，还是改为“拖拽/直接设定 + 保存”？

