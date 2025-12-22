# Step 13 — Web：Topic 列表 + 创建入口（M3-Web 起步）

## 目标

在 `apps/web` 做到最小可用：

- Topic 列表页（`GET /v1/topics`）
- 创建 Topic（`POST /v1/topics`，创建阶段不签名）
- 跳转到 Topic 详情页（路由打通）

来源：`docs/stage01/roadmap.md` M3、`docs/stage01/api-contract.md` 3.3/3.1。

## 依赖

- Step 02、Step 07

## 范围（本 step 做/不做）

- 做：
  - Web 基础页面/路由/数据拉取
  - 最小 UI（可先不做 Persona5 细节）
- 不做：
  - Focus View（Step 14）
  - 签名身份系统（Step 16）

## 1) Red：先写测试

对照全量规划：`docs/stage01/test-plan.md`（Suite W — Web 端到端验收：W1）。

由于当前 `apps/web` 未配置测试框架，先以 “能测试组件/数据流” 为目标建立最小测试基建：

- [ ] 增加 Web 单测框架（Vitest/Jest 二选一，但要能跑 React 组件测试）
- [ ] `TopicList` 组件：
  - fetch 成功渲染列表
  - fetch 失败展示错误态
- [ ] `CreateTopicForm`：
  - 校验必填
  - 提交后跳转到 `/topics/{topicId}`

## 2) Green：最小实现（让测试通过）

- `apps/web`：
  - 列表页：调用 `NEXT_PUBLIC_API_URL + /v1/topics`
  - 创建表单：调用 `POST /v1/topics`
  - 路由：`/topics/[topicId]` 占位页面（Step 14 再完善）
  - DTO：优先用 `packages/shared-contracts` 做运行时 parse（失败要有兜底）

## 3) Refactor：模块化与收敛

- [ ] 抽 `lib/apiClient`（统一 baseUrl、错误处理、DTO parse）
- [ ] 把“契约 parse 失败”区分为开发期错误（console）与用户态错误（toast/卡片）

## 4) 验收

> 前置：先按 `docs/stage01/coolify-target.md` export 环境变量（通用手册：`docs/stage01/coolify-acceptance.md`）。

### 服务器验收（推荐）

```bash
# 部署 API 和 Web
coolify deploy name "$API_APP_NAME" --force
coolify deploy name "$WEB_APP_NAME" --force
coolify app logs "$WEB_APP_UUID" -n 200
```

手动验收或 Playwright：

- [ ] 打开 `$WEB_BASE_URL` 能看到 Topic 列表（来自 `GET /v1/topics`）
- [ ] 创建 Topic：提交后跳转到详情页（URL 含 `topicId`）
- [ ] 返回列表后能看到新建 Topic
- [ ] API 不可用时：页面展示明确错误态（不白屏）

验收点：

- [ ] 能创建 topic 并在列表中出现
- [ ] 点击/创建后可进入详情页（占位也可）

### 本地快速反馈（可选）

```bash
pnpm -C apps/web test
pnpm -C apps/web dev
```

验收点：

- [ ] 组件测试通过
