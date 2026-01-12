# Stage04 — 多语种内容翻译（UI + UGC）概览

> 目标：用户点击 `中文/English` 后，**全站**内容都以对应语言展示；当译文缺失时允许回退原文；翻译可使用第三方模型（OpenRouter）。

## 1. 两类“多语种”

1) **UI 文案（静态）**

- 由前端 i18n 负责（cookie：`epiphany_locale`，默认 `zh`）。
- 切换语言立即生效，不依赖后端翻译。

2) **UGC（用户生成内容）**

- 由后端翻译模块负责：Topic / Argument / displayName（report 按需翻译）。
- 翻译异步执行，不阻塞读写；缺译文回退原文。
- 翻译完成通过 SSE `translation_updated` 自动触发前端刷新。

## 2. 关键约束（首期）

- 仅支持 `zh/en`。
- 允许把 UGC 发送给 OpenRouter（模型默认 `z-ai/glm-4.7`）。
- `displayName` 也纳入翻译覆盖。
- `report` 只在用户请求且缺译文时入队（按需）。
- 必须有硬预算闸门，避免翻译成本失控。

## 3. 设计与落地规格

详见：`docs/stage04/translation-module-spec.md`（包含数据模型、读写路径、SSE、预算闸门与验收）。

