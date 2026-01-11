# Stage03 — Design System（Academic Reading / White-label / LessWrong-feel）

本阶段的 UI/UX 基准来自：

- `apps/web/epiphany-v2-prototype`（交互与产品逻辑，见 `docs/stage03/prototype-core.md`）
- LessWrong 的“长文阅读 + 轻 UI 干扰”体感（排版、对比、层级、密度）

目标是把 `apps/web` 从 “Persona5 强风格（P5）”迁移到 **学术阅读 / 白标** 的长期可维护设计系统。

---

## 1. 设计原则（必须成立）

- **阅读第一**：长文默认用文章排版（`prose`），而不是卡片堆叠。
- **控件隐形**：只在需要时出现（hover/selection/底部 action 区），减少持续占位。
- **弱品牌 / 白标**：默认无全局 Header；只保留弱化的 “Hosted by Epiphany”。
- **可扩展的语义 tokens**：组件只使用语义变量（`--background`/`--foreground`/`--border`…），不直接硬编码颜色。

---

## 2. Tokens（来源与约束）

单一真源：

- `apps/web/app/globals.css`

约定：

- **语义 tokens**：`--background --foreground --muted --border --accent --destructive` 等为主。
- **排版 tokens**：`--font-body-stack --font-serif-stack --font-mono-stack`。
- **兼容层（Legacy）**：`--ink/--paper/--p5-*` 仍保留，但仅用于渐进迁移；新组件优先语义 tokens。

---

## 3. 组件命名（逐步替换 `P5*`）

现状：`apps/web/components/ui` 里仍保留 `P5*` 前缀文件名与导出（历史包袱）。

Stage03 规则：

- **新代码禁止引入新的 `P5*` 依赖**（不再扩大 P5 前缀的传播面）。
- **通过别名导出逐步迁移**：使用 `apps/web/components/ui/kit.ts` 提供的无前缀导出（`Button/Input/Modal/...`），旧代码可逐步替换 import。
- 迁移完成后再做“文件重命名 + 删除 P5 前缀”的破坏性整理（避免当前阶段大范围 churn）。

---

## 4. 阅读与写作（LessWrong-feel 落点）

- 阅读区：`prose prose-lg` + 限宽 `max-w-[760px]`；链接/引用/代码块样式跟随 tokens。
- 编辑器：默认编辑模式；工具栏可隐藏；引用选区出现 “引用”按钮并插入 blockquote（见 `TopicStage`）。

