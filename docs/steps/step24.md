# Step 24 — vNext：可视化扩展（后置）

## 目标

明确 vNext 的可视化扩展方向（不进入 v1.x MVP 的关键路径）：

- 旭日图等宏观树结构总览
- 更丰富的材质/动效库与组件体系沉淀（Persona5 对齐）

来源：`docs/roadmap.md` vNext、`docs/design.md`。

## 依赖

- Step 20（God View 基础）

## 1) Red：先写测试

- [ ] 组件库/可视化组件的可复用性测试（props/渲染一致性）
- [ ] 性能基准（至少有一个可重复的 perf 场景与阈值）

### Coolify CLI 服务器验收（黑盒）

- 前置：先按 `docs/coolify-target.md` export 环境变量（通用手册：`docs/coolify-acceptance.md`）。
- [ ] 部署 Web：`coolify deploy name "$WEB_APP_NAME" --force`
- [ ] 用 Playwright/手动在验收机上跑一次交互回归（确保不改 API 契约也能迭代视觉）

## 2) Green：最小实现（让测试通过）

- 旭日图：先做只读（输入为 tree），再做交互（hover/click）
- 动效与材质：沉淀为 design tokens + 可复用组件

## 3) Refactor：模块化与收敛

- [ ] 把可视化渲染与数据层分离（避免 UI 绑死后端查询形状）

## 4) 验收

- 命令
  - 服务器验收（推荐）：`coolify deploy name "$WEB_APP_NAME" --force`
- 验收点
  - [ ] 在不修改 API 契约的前提下可迭代视觉表现
