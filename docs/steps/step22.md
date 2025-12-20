# Step 22 — v1.1：共识报告（Habermas Machine / Prompt Chaining）

## 目标

把共识报告作为独立后置能力落地（不阻塞写路径）：

- Worker：`ai:consensus-report` 生成 `consensus_reports`
- 触发：Host 手动（先）+ 可后置自动触发
- UI：全屏/模态展示（Persona5 外框 + 正文排版）

来源：`docs/roadmap.md` v1.1、`docs/ai-worker.md` 相关章节。

## 依赖

- Step 03、Step 12、Step 21（Host 触发入口）

## 范围（本 step 做/不做）

- 做：
  - report 生成任务幂等（可重试不膨胀）
  - ready/failed 状态机
  - UI 可查看 latest report
- 不做：
  - 流式逐段输出（SSE 仍只做 invalidation）

## 1) Red：先写测试

- [ ] Worker：
  - job 幂等：同 reportId 重跑不重复生成
  - 失败语义：`status=failed`，error 写入 metadata
  - 生成成功：`status=ready`，`contentMd` 有值
- [ ] API：
  - 读取 latest report（若设计为公共读/私密读需先固定）
- [ ] Web：
  - 能打开模态并渲染 markdown（失败/生成中有状态提示）

## 2) Green：最小实现（让测试通过）

- `consensus_reports` 表字段与契约对齐（Step 03 已预留则复用）
- Worker：mock provider 起步，后续接真实 LLM
- API：增加 report 读取接口（或复用 topic commands 触发并返回）

## 3) Refactor：模块化与收敛

- [ ] 把 prompt chaining 版本号固化（`promptVersion`）便于回溯
- [ ] 生成输入口径固定（过滤 pruned、按权重抽样等需文档化）

## 4) 验收

- 验收点
  - [ ] Host 可触发生成并在 UI 查看
  - [ ] 不影响核心写路径（createArgument/setVotes 仍快速返回）

