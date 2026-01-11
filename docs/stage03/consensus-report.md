# Stage03 — AI 分析报告 / 共识报告（TalkToTheCity × Habermas Machine）

本文件定义 Epiphany 的「AI 分析报告 / 共识报告」产品方案与内容标准：既能像 TalkToTheCity 一样**可追溯地总结**讨论，也能参考 DeepMind 的 Habermas Machine 一样**提炼可被多方接受的共识**，并把“角色（阵营/立场）—观点—证据”的结构组织成可视化图谱。

> 范围：只做设计与文档，不进入开发实现。  
> 参考与约束：`docs/stage03/prototype-core.md`、`docs/stage03/design-system.md`、`docs/stage03/topic-privacy.md`、`docs/stage01/prd.md`、`docs/stage01/api-contract.md`、`docs/stage01/database.md`、`docs/stage01/ai-worker.md`。

---

## 0. 北极星（North Star）

**一份精彩的报告**不是“把大家说过的话复述一遍”，而是把讨论变成三类可用的东西：

1. **可定位的共识**：哪些话可以被不同阵营同时签字（或在什么条件下签字）？
2. **可解释的分歧**：分歧不是“吵”，而是“价值/事实/预测/约束不同”导致的结构性张力。
3. **可返回的证据**：任何结论都必须能一键回到原始论点节点（而不是 AI 自说自话）。

对应到用户体验：

- **宏观**：1 分钟读懂“有哪些阵营、在争什么、已经同意什么、下一步该讨论什么”。
- **微观**：每一句重要判断都能展开到“来自哪些来源、各阵营为什么这么说、反例在哪里”。

---

## 1. TalkToTheCity 风格的“总结标准”（内容质量门槛）

把 TalkToTheCity 的可用性总结为 6 条硬标准（报告生成/评审的 checklist）：

1. **主题分层**：结论必须按“主题 → 子主题 → 关键主张（claims）”组织，避免平铺流水账。
2. **代表性引用**：每个主题至少包含若干条可验证的原文引用（短摘录），并标明来源标签（见 §4）。
3. **可追溯**：报告中的断言要么带来源标签（`[S12]`），要么明确标注为推测/待验证。
4. **覆盖度与偏差提示**：报告必须告诉读者“用了多少材料、覆盖了多少票数/参与者、可能遗漏了什么”。
5. **少数意见保护**：不能只写“高票观点”；必须显式呈现重要但低票的结构性反对理由（哪怕只占少数）。
6. **可继续提问**：报告本身要可被“追问”，至少做到“点开来源 → 回到原文节点”，并预留后续“Ask this report”的接口位（非本阶段实现）。

---

## 2. 报告交付形态（Markdown + 结构化元数据）

现有契约（`docs/stage01/api-contract.md` 2.8）以 `ConsensusReport.contentMd` 为主。为了同时满足“可读”与“可交互”，建议采用：

- **主内容：`content_md`（Markdown）**  
  面向阅读：像研究报告一样排版、可导出、可分享。
- **结构化：`metadata/params`（JSON）**  
  面向交互：角色图谱、来源映射、主题/主张结构、接受度矩阵等（不强依赖前端解析 Markdown）。

> 关键原则：**渲染可降级**。即使只拿到 `contentMd`，也必须是完整可读的报告；拿到 `metadata` 则增强交互与可视化。

---

## 3. 报告结构模板（宏观 → 微观的分层信息披露）

建议固定为“7+2”结构：前 7 个章节是读者主路径；最后 2 个章节是方法与证据附录。

### 3.1 主路径（读者 1～10 分钟）

1. **TL;DR（30 秒）**
   - 3～7 条要点：共识、分歧主轴、下一步问题（都尽量带来源）。
2. **共识快照（Consensus Snapshot）**
   - “可签字的句子”列表（见 §6），每条附：接受度（按角色）+ 条件/保留项 + 来源。
3. **分歧主轴（Key Tensions）**
   - 2～5 条“争议坐标轴”（例如：速度 vs 安全、集中化 vs 分散化、短期福利 vs 长期风险）。
4. **角色图谱（Role Atlas）**
   - 角色卡片 + 角色关系图（见 §5）。
5. **主题拆解（Themes）**
   - 每个主题下：共识点/分歧点/代表性引用/关键反驳链路。
6. **共识桥梁（Bridge Statements）**
   - 解释“为什么这句话能跨阵营成立”，并列出触发条件与仍然无法覆盖的反对理由。
7. **未决问题与下一步（Agenda）**
   - 把分歧转成可继续讨论的问题清单：需要补数据？需要定义术语？需要做价值选择？

### 3.2 附录（读者 10～30 分钟 / 研究者）

8. **方法与覆盖（Method & Coverage）**
   - 输入口径、抽样策略、覆盖度指标、模型/版本、已知偏差。
9. **Sources（证据清单）**
   - `S1..Sn` 的来源列表：短摘录 + 票数/层级等最小上下文 + 可点击回到原文（见 `docs/stage03/topic-privacy.md` 7.3 来源溯源方案）。

---

## 4. 证据与引用标准（让报告“可审计”）

### 4.1 来源标签（S1..Sn）

对外部模型输入：用临时标签 `S1..Sn` 标注来源；对产品内：用 `metadata.sources` 维护 `S* -> argumentId/authorId` 映射，并把报告里的 `[S3]` 渲染为可点击来源（详见 `docs/stage03/topic-privacy.md` 7.3）。

### 4.2 断言等级（防止过度概括）

报告里每个“结论句”建议打一个最小标签（可隐式或仅在 metadata 中存在）：

- **Observed**：直接从多条来源可归纳（必须有引用）
- **Contested**：存在明确反对来源（必须同时给支持/反对引用）
- **Speculative**：推测/建议（必须声明假设条件，并尽量引用作为动机的来源）

### 4.3 基本约束（可自动校验）

- 每个主题至少 `>= 2` 个来源引用，且尽量跨不同角色。
- 报告正文中出现的每个 `[Sx]` 必须在 `Sources` 附录与 `metadata.sources` 可解析。
- 引用摘录不得超出来源原文（可做字符级一致性校验：仅文档化要求，不在本阶段实现）。

---

## 5. 角色图谱（Role Atlas）：把“人群/立场”做成可导航的地图

### 5.1 概念：Role ≠ 用户，Role = 观点组织方式

在匿名体系下（Topic 内 pubkey 不可跨 Topic 关联），报告中的“角色”应当被定义为：

- **讨论中的稳定视角/利益关切/价值框架**（stakeholder archetype）
- 而不是现实世界身份（年龄/职业/地域等），也不推断个体画像

### 5.2 Role 卡片（每个角色至少包含）

每个 Role 以一张“研究报告式卡片”呈现：

- **名称**：中性、可读、可由 Host 重命名（例如“效率优先派 / 风险约束派”）
- **一句话立场**：这个角色“最在乎什么”
- **核心主张（Top claims）**：3～7 条（每条必须带来源）
- **核心反对（Top objections）**：2～5 条（同样带来源）
- **可接受条件（Acceptability conditions）**：当哪些前提成立时，会接受哪些桥梁句（见 §6）
- **规模指标（可选）**：票数占比、参与者占比、覆盖来源数（这些是“讨论强度”，不是“正确性”）

### 5.3 Role 图谱（Graph）怎么画（产品视图）

推荐把 Role 图谱做成“可解释的关系网”，而不是仅凭 embedding 距离的玄学点云：

- **节点**：Role
- **边（对齐）**：共享的“可签字句子”或“同向主张”
- **边（张力）**：在关键主张上呈现系统性相反的立场
- **边的解释**：每条边至少能展开显示 3 条“导致对齐/冲突的主张”（并链接到对应来源）

> 直觉：用户不是要看“谁离谁近”，而是要看“为什么近/为什么远”。

### 5.4 Role 从哪里来（生成策略建议）

允许多种生成策略并写入 `params`，避免把“角色划分”伪装成真理：

1. **LLM 角色抽取（推荐 v1）**：从来源中抽取若干稳定视角，并要求每个 Role 明确绑定来源集合。
2. **Camp → Role（可选）**：复用 `camps/cluster_data` 的聚类结果，把每个 cluster 作为候选 Role 或 Role 的主题域。
3. **投票行为聚类（后置）**：用 Topic 内 pubkey 的投票向量聚类得到真实“投票联盟”，再由 LLM 解释成可读 Role（隐私边界仍在 Topic 内）。

---

## 6. Habermas Machine 风格的“共识提炼”（Prompt Chaining 协议）

目标不是输出“中庸的套话”，而是产出一组**可验证、可接受、可推进讨论**的桥梁句（Bridge Statements）。

### 6.1 输入：Evidence Pack（可回溯、可控规模）

报告生成前构造输入包（写入 `params.selection`）：

- 过滤：排除 pruned；可选排除 analysisStatus!=ready 的节点（或仅降低权重）
- 采样：root + Top by votes + 分层抽样（按主题/cluster/层级/立场）补齐长尾
- 预算：`maxSources`/`maxCharsPerSource`（必要时再加 `maxTotalChars`，保证落在模型上下文窗口内）

每条来源以如下最小结构喂给模型（示意）：

```txt
[S17] (votes=42, depth=3, stance=oppose)
<excerpt or full text...>
```

### 6.2 过程：五段式链路（建议 v1.1）

1. **Sensemaking（主题与主张抽取）**
   - 输出：Themes、原子 Claims（区分事实/价值/政策建议）、每个 Claim 的支持/反对来源集合。
2. **Role induction（角色归纳）**
   - 输出：Roles（每个 Role 绑定 sources），并为每个 Role 生成“可用于后续评审的立场摘要”（role brief）。
3. **Bridge drafting（桥梁句草案）**
   - 输出：候选 Bridge Statements（每条必须附来源；必须写明适用范围与条件）。
4. **Deliberative critique（多角色批评）**
   - 模拟“每个 Role 审阅每条桥梁句”：接受/拒绝/接受但需改写 + 理由 + 最小改写建议。
5. **Recursive revision（递归修订）**
   - 按“最大化总体可接受度”的目标做 1～3 轮修订；输出：
     - 最终 Bridge Statements（附接受度矩阵）
     - 无法达成共识的“硬分歧点”（并解释原因类型：事实不确定/价值冲突/约束冲突）

> 关键纪律：批评与修订必须引用来源；不能凭空发明“大家都同意/不同意”。

### 6.3 接受度矩阵（报告中最有力量的表）

对每条桥梁句给出按 Role 的接受度（示意等级）：

- `ACCEPT`（可签字）
- `CONDITIONAL`（接受但需条件/补充）
- `REJECT`（拒绝）
- `NOT_ADDRESSED`（该句未触及该 Role 的核心关切）

并要求：

- 每个 `REJECT` 都要给出“拒绝原因摘要 + 至少 1 条来源”
- 每个 `CONDITIONAL` 都要给出“需要的条件（可操作/可验证）”

---

## 7. 质量与安全（让报告可信、可控、可复用）

### 7.1 质量指标（建议写入 metadata 便于前端展示）

- `coverage.argumentsIncluded / argumentsTotal`
- `coverage.votesIncluded / votesTotal`（避免“只看高票”或“只看长尾”）
- `citationRate`：正文结论句带引用的比例
- `roleBalance`：每个 Role 在报告中的引用次数分布（防止某一 Role 被隐形）

### 7.2 失败模式与护栏

- **幻觉**：没有来源的事实断言 → 必须降级为 Speculative 或删去
- **多数暴政**：只总结高票 → 必须引入分层抽样与“少数反对理由”
- **标签伤害**：Role 命名带侮辱/推断现实身份 → 强制中性命名 + Host 可改名
- **隐私越界**：向外部模型发送内部稳定标识 → 只发送 `S*` 标签与去标识文本（参见 `docs/stage03/topic-privacy.md` 7.3）

---

## 8. Stage03 的阅读体验落点（不开发，但先定交互语义）

对齐 `docs/stage03/design-system.md` 的“学术阅读 / 白标 / LessWrong-feel”：

- 报告默认以**文章视图**渲染（`prose` 排版、限宽、目录导航）。
- 右侧/抽屉提供 **Role Atlas**：点角色 → 高亮相关段落/引用 → 一键跳回原论点节点。
- `[Sx]` 点击打开来源卡片：短摘录 + 票数 + “打开原文”。
- 在报告顶部固定一个“方法与覆盖”信息条：让读者第一眼知道这份报告的边界与可靠度。

---

## 9. `params` / `metadata` 建议结构（为后续交互预留）

> 目的：让报告不仅是“文本”，还是可驱动交互与可视化的数据产品。字段命名以可读性为先，可在实现阶段再与 Prisma/契约对齐。

### 9.1 `params`（生成参数，可回溯）

示意：

```json
{
  "promptVersion": "report_v1.1_stage03",
  "model": "deepseek/deepseek-chat-v3-0324",
  "selection": {
    "strategy": "root+topVotes+stratified",
    "maxSources": 120,
    "maxCharsPerSource": 1200,
    "includePruned": false,
    "seed": 42
  },
  "habermas": {
    "maxIterations": 3,
    "minRoleAcceptRate": 0.7,
    "minVoteWeightAcceptRate": 0.7
  }
}
```

### 9.2 `metadata`（结构化结果，供前端交互）

示意：

```json
{
  "coverage": {
    "argumentsTotal": 512,
    "argumentsIncluded": 120,
    "votesTotal": 1180,
    "votesIncluded": 980,
    "notes": ["长尾已做分层抽样", "pruned 已过滤"]
  },
  "sources": {
    "S17": {
      "argumentId": "uuidv7",
      "authorId": "uuidv7",
      "totalVotes": 42,
      "depth": 3,
      "stance": -1,
      "clusterId": 2,
      "excerpt": "..."
    }
  },
  "themes": [
    {
      "themeId": "T1",
      "label": "再培训与教育体系",
      "summary": "...",
      "sourceIds": ["S2", "S7", "S17"],
      "claimIds": ["C3", "C9"]
    }
  ],
  "claims": [
    {
      "claimId": "C3",
      "text": "教育/再培训体系需要结构性调整以应对岗位迁移",
      "type": "policy",
      "supportSourceIds": ["S2", "S7"],
      "opposeSourceIds": ["S17"],
      "status": "contested"
    }
  ],
  "roles": [
    {
      "roleId": "R1",
      "name": "效率优先派",
      "oneLiner": "最在乎创新速度与机会成本",
      "sourceIds": ["S2", "S9"],
      "topClaimIds": ["C3"],
      "topObjectionClaimIds": ["C12"]
    }
  ],
  "bridgeStatements": [
    {
      "bridgeId": "B1",
      "text": "在不阻碍创新的前提下，提前建立转型期的再培训与安全网，是多数角色可接受的起点。",
      "conditions": ["不设置一刀切禁令", "明确评估指标与退出机制"],
      "sourceIds": ["S2", "S4", "S9"],
      "acceptanceByRole": {
        "R1": { "label": "ACCEPT", "reasonSourceIds": ["S2"] },
        "R2": { "label": "CONDITIONAL", "reasonSourceIds": ["S4"] }
      }
    }
  ],
  "roleGraph": {
    "edges": [
      {
        "a": "R1",
        "b": "R2",
        "alignmentClaimIds": ["C3"],
        "tensionClaimIds": ["C12"],
        "score": -0.2
      }
    ]
  },
  "quality": {
    "citationRate": 0.92,
    "roleBalance": { "R1": 0.28, "R2": 0.24 }
  }
}
```

> 隐私提醒：以上 `argumentId/authorId` 仅用于产品内渲染与溯源；对外部模型输入仍应只使用 `S*` 标签与去标识文本（见 `docs/stage03/topic-privacy.md` 7.3）。

---

## 10. 报告片段示例（示意：宏观到微观如何“可展开”）

> 下面是格式示意，不代表任何真实 Topic 的结论。

### 10.1 TL;DR（宏观）

- 讨论已形成若干稳定角色框架：对“速度/安全、短期/长期、集中/分散”的取舍不同（见 Role Atlas）。
- 跨角色最易达成的共识集中在“需要可执行的过渡方案与评估指标”，但在“干预力度与边界”上仍存在硬分歧。[S2][S4][S9]

### 10.2 Bridge Statement（可签字句子 + 接受度）

**B1**：在不阻碍创新的前提下，提前建立转型期的再培训与安全网，是多数角色可接受的起点。[S2][S4][S9]

接受度（示意）：`R1=ACCEPT`，`R2=CONDITIONAL(需要明确退出机制)`，`R3=REJECT(认为会被滥用)`。

### 10.3 角色卡片（微观入口）

**R2：转型成本警觉派**  
一句话立场：最在乎转型期的失业、阶层下滑与不可逆伤害。  
核心主张：需要更强的保障与再分配工具来覆盖外部性。[S4][S10]  
核心反对：反对把“历史会自我修复”当作默认前提。[S10][S17]

---

## 11. 传播与增长（把报告做成“可分享的研究产物”）

报告是 Epiphany 的核心传播点：它既是“外部世界第一次理解这个 Topic 的入口”，也是“读者愿意转发的内容形态”。因此传播设计必须与报告结构一起被“内建”。

### 11.1 传播目标（Share Goals）

- **低摩擦理解**：陌生读者在 30 秒内知道“这份报告讲什么、有什么发现、值不值得继续读”。
- **高可信度**：读者能一眼看到覆盖范围、来源可追溯与生成版本（降低“AI 胡说”的天然不信任）。
- **可拆分分享**：整篇可分享；更重要的是“某个桥梁句 / 某个角色卡 / 某条张力轴”也可独立成传播单元。
- **可回流参与**：分享不是终点，报告必须把人带回 Topic（读原文、投票、补充论证）。

### 11.2 报告页即 Landing Page（进入体验决定分享意愿）

为“从外部链接进入”的读者定一条主路径（不依赖站内导航）：

- 首屏是 **Cover + TL;DR + 共识快照**，并固定展示 `Method & Coverage` 信息条（见 §3.2/§8）。
- 把“深读入口”做成明确按钮：`查看角色图谱` / `查看来源` / `进入讨论地图` / `参与讨论（写/投票）`。
- 默认可读、可复制、可打印（学术阅读的自然传播方式：截图/引用/转发链接）。

### 11.3 Share Pack：把报告拆成可传播的“卡片资产”

建议把一次报告生成同时产出一组可分享资产（概念层，不在本阶段实现）：

1. **Report Cover Card**：标题 + 生成时间 + 3 个关键数字（参与者/票数/来源数）+ 1 句“最强发现”（可选）。
2. **TL;DR Card**：3～7 条要点（每条尽量带 `[Sx]`），适配社交平台的“信息密度”。
3. **Bridge Statement Cards（最重要）**：每条桥梁句一张卡，附“接受度概览（按角色）”与来源标签。
4. **Role Cards**：角色一句话立场 + Top claims/objections（各 1～3 条）+ 可点击回到 Role Atlas。
5. **Tension Axes Poster**：2～5 条分歧轴的“坐标海报”，强调结构而非情绪。

输出规格建议同时覆盖：`1200x630`（OG）、`1080x1080`（方图）、`1080x1920`（长图/故事）、`A4`（PDF）。

### 11.4 深链接与可引用性（让“分享某一句”变成产品能力）

传播的最小单位往往不是整篇，而是“一个段落/一句桥梁句/一个角色”：

- 每个章节、每个 Role、每条 Bridge Statement 都有稳定锚点：例如 `#role-R2`、`#bridge-B1`。
- 报告正文中出现的 `[Sx]` 可点击，并能在来源卡片里“复制引用”（包含短摘录 + 链接）。
- 支持“选中文本 → 生成引用卡片”的交互（类似论文引用/Medium 引用），默认带回链 URL。

### 11.5 设计驱动的传播（少品牌，多“可信的视觉语言”）

Stage03 的白标目标不等于无设计；传播更需要“可信的视觉语言”：

- **信息优先的视觉层级**：TL;DR、共识快照、分歧轴、角色卡必须可一眼扫读。
- **可截图的版式**：段落间距、引用块、关键句高亮（pull quote）要天然适合截图传播。
- **轻品牌露出**：卡片底部仅保留 `Hosted by Epiphany` + 报告 ID/时间戳（用于可信回链，而非广告）。
- **防篡改暗示（可选）**：分享卡片可带短 `reportId` 与二维码，指向原报告 URL（适配中文社交传播）。

### 11.6 隐私与传播的兼容（不让分享变成泄密）

对齐 `docs/stage03/topic-privacy.md` 的边界，传播必须分级：

- `public`：允许 OG/SEO；Share Pack 默认开启。
- `unlisted`：允许分享链接，但默认 `noindex`；Share Pack 仍可开启（由 Host 控制）。
- `private`：默认不生成可外链的 Share Pack；若 Host 选择分享，则必须明确提示“这会传播讨论内容”，并只在链接持有者可见（或提供“去敏公开摘要版”作为后置扩展）。

### 11.7 回流机制（让转发带来讨论推进，而不是围观）

在报告中内建 3 类回流 CTA（避免泛泛“去评论”）：

- **补证据**：在 `Key Tensions` 下给出“最缺的数据/证据”清单，点击即定位到对应论点节点的回复框。
- **投票校准**：对每条 Bridge Statement 提供“我是否接受”的轻量反馈入口（可映射到投票或单独的桥梁投票，后置实现）。
- **开新支线**：把 `Agenda` 里的问题一键变成“新论点节点（root 的子节点）”，让讨论沿着报告推进。

### 11.8 编辑层（让 Host 把“精彩”变成可控的输出）

传播效果往往来自“编辑选择”，而不是更长的全文。建议把以下能力作为报告的上层控制面（先写入文档与 `params`，实现可后置）：

- **Featured Highlights**：Host 从 `Bridge Statements / Key Tensions / Role Cards` 中挑选 3～7 个作为“首屏高亮”。
- **角色命名与合并**：Role 的默认名由 AI 生成，但 Host 可改名/合并/拆分（避免标签伤害与语义噪声）。
- **一句话封面文案**：为 Cover Card 提供“可传播的一句话发现”，并要求必须可被来源支撑（否则标为 Speculative）。
- **分享分级开关**：针对 `unlisted/private` 明确“允许生成 Share Pack / 仅内部可见 / 生成去敏摘要”的选择。

### 11.9 版本化（把报告做成“持续演化的公共记录”）

报告作为传播物需要“时间感”：

- **Latest + Permalink**：默认分享 latest；同时保留每次生成的永久链接（便于引用与对照）。
- **Diff 视图（后置）**：展示本次与上次相比：新增/消失的共识句、角色变化、分歧轴变化（促进二次传播：`更新了什么`）。
- **节奏提示**：在 Cover 上显示“最后更新时间”与“下次建议生成窗口”（由 Host 或系统阈值给出）。

### 11.10 分享文案与 OG 预览（让“转发时就很好看”）

为每份报告与每个卡片资产定义可机器生成的分享字段（可写入 `metadata.share`）：

- `ogTitle`：Topic 标题 + “共识报告”
- `ogDescription`：TL;DR 前 1～2 条（带“覆盖度数字”缩写，如 `980/1180 votes covered`）
- `ogImage`：Cover Card（白标但可信，带日期/报告 ID）
- `shareText`：一段可复制的短文本（不超过 280 字/两段），默认包含 1 条桥梁句 + 1 条分歧轴 + 报告链接

> 传播的本质是“别人替你转述你的结论”。如果转述成本高，分享就会失败；因此分享文案必须是报告生成的一等产物。

---

## 12. Topic 页面：点击“报告”后的展示与交互（Stage03）

> 目标：报告既是“研究产物”，也是 Topic 的传播入口；在 Topic 页面内打开报告必须做到：不打断探索/阅读，又能随时回到证据与讨论。

### 12.1 入口与状态（Topic Header 的单一按钮）

在 Topic 页面提供单一入口按钮：`Report`（建议放在 Topic 标题行右侧或 Host 控件旁）。

按钮状态与文案：

- `No report`：仅 Host 显示 `Generate report`；非 Host 显示 `Report (not generated)`（点击进入解释页/空态）。
- `Generating`：所有人可点开，进入“生成中”视图（可关闭回 Topic 继续阅读）。
- `Ready`：点击打开报告阅读视图；按钮副文案显示 `Updated {timeAgo}`。
- `Failed`：点击打开错误视图；仅 Host 显示 `Retry`。
- `Outdated`（派生状态）：Ready 但发生明显漂移（见 §13.3），按钮显示 `Update recommended`（仅 Host 可触发更新）。

### 12.2 展示形态（全屏阅读叠层 + 可分享锚点）

为传播与引用，建议把报告做成**可路由的全屏阅读视图**（而不是纯 modal 的临时 UI）：

- 路由建议：`/topics/:topicId/report`（latest），可追加 `?rid=:reportId`（permalink）。
- 打开方式：点击 Topic 页 `Report` → 进入该路由（保留返回栈）；关闭/返回即回到 Topic 页原位置。

布局（Stage03 设计语义）：

- 顶部：极简 header（Topic 标题 + 报告时间 + 覆盖度 + 分享按钮 + 关闭/返回）。
- 中部：文章排版（`prose`），带目录（TOC）。
- 右侧（或抽屉）：Role Atlas（角色列表/关系），用于“从宏观入口跳到证据”。

### 12.3 首屏：Bridge Gallery（把分享单元放在最前面）

报告页首屏（TL;DR 之前或紧随其后）固定呈现 **Bridge Gallery**：

- 默认展示 **3** 张 “Bridge Statement 卡”（见 §14），按“跨角色可接受度”排序；提供 `View all bridges` 展开查看其余桥梁句（仍然来自同一份 reportId）。
- 每张卡提供：`Share`（复制链接/图片）与 `Open context`（跳到报告正文中该桥梁句）。
- 允许 Host 置顶（`metadata.share.featuredBridgeIds`）。

### 12.4 “从结论回到证据”的闭环（Sources 与返回 Topic）

交互规则：

- 报告正文中的 `[Sx]` 可点击 → 打开来源卡片（excerpt + 最小上下文 + `Open original`）。
- `Open original` 默认在新叠层打开 Argument Reader（保持报告在背景），并提供 `Back to report`。
- 在来源卡片中提供 `Copy citation`：生成包含摘录、来源标签与 permalink 的引用文本。

> 体验目标：读者不必“相信 AI”，而是被引导去验证，并自然回到讨论现场。

### 12.5 生成中/失败空态（不让用户困惑）

`Generating` 视图（对齐 `docs/stage02/UX_UI_PLAN.md` 的阶段感，但用 Stage03 白标视觉）：

- 进度条仅展示“阶段名”，避免伪精确百分比：
  - Collect sources → Induce roles → Draft bridges → Multi-role critique → Revise → Render report
- 允许关闭；关闭后 Topic 页按钮仍显示 Generating。
- 生成完成后：SSE `report_updated` 触发刷新；若报告页仍打开，则提示 `New version available` 并允许一键切换到 latest（不强行跳转）。

`Failed/No report` 空态：

- 解释报告是什么、需要 Host 触发、会引用来源、以及隐私提示（若使用外部模型，见 `docs/stage03/topic-privacy.md` 7.3）。
- Host 专属 CTA：`Generate report` / `Retry`（带二次确认与成本/时间提示）。

---

## 13. 报告生成规则（触发、口径、更新策略）

> 目标：生成规则既要“可解释”，也要“可控成本”，并且能产出适合传播的 Bridge Statements。

### 13.1 触发规则（v1：Host 手动为主，自动为后置）

v1（推荐）：

- **仅 Host 手动触发**：调用 `POST /v1/topics/:topicId/commands` 的 `GENERATE_CONSENSUS_REPORT`（见 `docs/stage01/api-contract.md` 3.2）。
- 系统仅做“建议更新”，不自动生成（避免误触发与成本不可控）。

后置（可选）：

- **Auto**：当 Topic 满足“更新推荐”条件并且 Host 开启 `Auto-update reports` 时，Worker 自动生成 latest（仍遵守 cooldown）。

### 13.2 幂等与并发（避免重复生成与抖动）

规则建议：

- 同一 Topic 同一时间最多允许 1 个 `generating` report。
- 若已有 `generating`：
  - 再次触发默认返回成功回执但不重复入队（幂等）。
  - Host 可使用“Force regenerate（后置）”覆盖（会取消/标记旧任务并创建新 reportId）。
- 写入 `params`：记录 `promptVersion/model/selection/seed`，保证可回溯与可复现。

### 13.3 “更新推荐（Outdated）”判定（传播友好：告诉读者边界）

把 Ready 报告标为 `Outdated` 的建议规则（任一满足即可；Stage03 默认见 §13.7）：

- `newArgumentsSinceReport >= thresholdBySize(argumentsTotal)`（小 Topic 更敏感，大 Topic 更稳定）
- `votesDeltaRatio >= thresholdVotesDelta`（票数权重漂移显著）
- `newPrunesOrUnprunes >= 1`（结构/可见性变化对结论影响极大）
- `rootEditedSinceReport >= 1`（根论点变更意味着“题目/定义”已变）
- `cluster_updated` 且 `clusterShiftScore >= thresholdClusterShift`（仅当依赖聚类辅助角色/主题时启用）

并设置 cooldown：

- `updateRecommendationCooldown` 内最多提示一次“建议更新”，避免频繁打扰 Host。

### 13.4 输入口径（Evidence Pack 的固定选择策略）

默认输入选择（写入 `params.selection`）：

- 必含：Root + 其下高权重路径（保证主叙事）
- Top by votes：按 `Argument.totalVotes` 取前 `topVotesK`
- 分层补齐（stratified sampling）：
  - 按深度（depth）与 stance（-1/0/1）分桶，先满足每桶最小配额，再按权重补齐（避免只看高票/只看浅层）
  - 若有 cluster：保证“头部 clusters”有最小覆盖，并显式补齐“该 cluster 的最强反对理由”
- 长尾保护：额外取若干低票但结构性重要的反对意见（由 LLM 判别“是否是核心 objections”，但必须带来源）
- 过滤：pruned 默认排除；analysisStatus!=ready 可降权或只抽 excerpt
- 上限：`maxSources` 与 `maxCharsPerSource`，保证在模型窗口内

> 原则：用“可解释的规则”定义输入，而不是把“选哪些材料”完全交给模型。

### 13.5 Bridge Statements 的生成与筛选（服务传播）

生成目标：

- 产出 `bridgeFinalCount` 条桥梁句（Stage03 默认 7）：优先“可签字”、其次“条件共识”、最后“可推进的最小共同点”。
- 额外：产出少量“候选桥梁句”（Stage03 默认 12）用于去重与筛选（避免只产出 3 条导致质量不稳）。

筛选规则建议（写入 `metadata.bridgeSelection`）：

- 先过滤：无来源引用的桥梁句直接淘汰（或降级为 Speculative 且不出现在 Bridge Gallery）。
- 再过滤：桥梁句必须覆盖 `>= 2` 个角色的核心关切（否则只是“单方宣言”）。
- 再排序：按 `acceptRateByRoleWeight` 排序（Stage03 默认：`ACCEPT=1, CONDITIONAL=0.5, NOT_ADDRESSED=0, REJECT=-1`；角色权重来自“该角色 sources 的 totalVotes 占比”，取平方根后归一化）。
- 再去重：语义相近的桥梁句合并/择优（避免“同一句换个说法”）。
- 必包含（正文层面）：至少 1 条“条件共识”（CONDITIONAL）与至少 1 条“硬分歧说明”（让读者看到边界）。
- Bridge Gallery（传播首屏）：默认取排序前 3 条；若不足 3 条满足质量门槛，则用“条件共识”补齐并显式标注条件。

### 13.6 输出要求（质量门槛，不达标就降级提示）

建议设置最小门槛（写入 `metadata.quality`）：

- `citationRate >= 0.85`（关键结论句带来源）
- `coverage.votesIncluded / votesTotal >= 0.6`（避免只选少量材料）
- 每个“主要 Role”（按权重 Top 3）至少出现 `>= 5` 次引用（防止隐形）
- Bridge Gallery 的 3 条桥梁句每条至少有 `>= 3` 条来源，并且至少关联 `>= 2` 个不同 Role

若未达标：

- 报告仍可 `ready`，但在 `Method & Coverage` 显示黄色提示：`Low coverage / Low citation`（传播时减少误导）。

### 13.7 Stage03 默认参数（可调整，但必须写入 params/metadata）

为避免“每次生成都像一次实验”，Stage03 建议固定一组默认值：

- `bridgeGallerySize = 3`
- `bridgeCandidateCount = 12`
- `bridgeFinalCount = 7`
- `maxSources = 120`
- `maxCharsPerSource = 1200`
- `maxTotalChars = maxSources * maxCharsPerSource`（可选：用于对总输入规模做硬上限）
- `topVotesK = 40`
- `strata`：`stance ∈ {-1,0,1}` × `depthBin ∈ {1, 2-3, 4+}`，每桶优先填满 `minPerBucket = 6`（不足则跳过），再按权重补齐剩余预算
- `longTailObjectionCount = 10`（用于保证少数但关键的反对理由）
- `thresholdBySize(argumentsTotal) = max(10, min(40, ceil(argumentsTotal * 0.08)))`
- `thresholdVotesDelta = 0.25`
- `thresholdClusterShift = 0.35`（仅当启用 cluster 辅助时）
- `updateRecommendationCooldown = 2h`
- `minTimeBetweenGenerations = 15m`（Host 连续点击时给出提示；强制重生成可后置）

### 13.8 默认值的决策逻辑（为何这样定）

- `bridgeGallerySize=3`：首屏信息密度上限；3 张卡既“足够形成观点”，又不压过正文；也更适合社交截图/转发预览。
- `bridgeFinalCount=7`：给读者“还有别的桥梁句可看”的空间，同时避免把报告变成口号集。
- `maxSources/maxCharsPerSource`：用固定预算换取稳定成本；再用分层抽样确保覆盖不是“只看高票”。
- `thresholdBySize/thresholdVotesDelta`：把“更新推荐”绑定到结构与权重漂移，避免小改动导致报告频繁失效。
- `updateRecommendationCooldown/minTimeBetweenGenerations`：控制打扰与成本；同时通过 `?rid=:reportId` 确保分享时版本固定（见 §14.3）。

---

## 14. Bridge Statement 卡（主传播单元）规范

> 这张卡是 Epiphany 的“可转发结论单位”。设计目标：单卡可读、可引用、可追溯、可回流。

### 14.1 内容字段（卡片必须包含）

- `bridgeId`：例如 `B1`（用于锚点与 permalink）
- `text`：桥梁句正文（尽量是可签字句子）
- `conditions`：若为条件共识，必须列出 1～3 条可操作条件
- `acceptanceSummary`：按角色的接受度概览（至少展示 2～4 个主要角色，剩余折叠）
- `sources`：卡面至少展示 2 个 `[Sx]`（可显示 `+n more`）；该桥梁句在 metadata 中应绑定 `>= 3` 个来源
- `timestamp`：报告时间（防止“旧结论被当作新结论”）

### 14.2 版式（截图友好 + 防断章取义）

推荐布局（白标、学术感）：

- 顶部：`Bridge Statement · B1` + Topic 标题（小字）
- 主体：大字号正文（可做 1 行高亮，但避免夸张视觉）
- 次级：`Conditions`（如有）+ `Acceptance`（角色条形/矩阵摘要）
- 底部：`[Sx]` footnotes + 报告时间 + `Hosted by Epiphany` + 二维码/短链接（可选）

护栏：

- 若桥梁句为条件共识（CONDITIONAL），卡片必须显式显示条件；否则禁止导出分享图（避免误导）。

### 14.3 分享动作（转发成本最小化）

每张卡支持 3 个一键动作（概念层）：

- `Copy link`：复制 permalink（默认携带 `?rid=:reportId` 固定版本，并指向 `#bridge-B1`，避免“转发后内容变了”）
- `Copy image`：复制卡片图（用于微信/小红书等）
- `Copy text`：复制短文本（包含桥梁句 + 1 行覆盖度缩写 + 链接）

### 14.4 与 Topic 回流的连接

卡片上的点击路径：

- 点击正文/`Open context` → 打开报告对应段落（锚点）
- 点击 `[Sx]` → 打开来源卡片 → `Open original` 回到 Topic 的 Argument Reader
