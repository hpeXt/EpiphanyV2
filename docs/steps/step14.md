# Step 14 — Web：Topic 详情（Focus View 首屏 + Dialogue Stream）（M3-读路径 UI）

## 目标

在 Topic 详情页跑通读路径：

- 首屏：`GET /v1/topics/:topicId/tree?depth=3`
- 点击节点：右侧 Dialogue Stream 拉 `GET /v1/arguments/:argumentId/children`
- 支持“最新/最热”切换与分页（`beforeId/nextBeforeId`）

来源：`docs/roadmap.md` M3、`docs/core-flows.md#2`、`docs/api-contract.md` 3.4/3.5。

## 依赖

- Step 02、Step 08、Step 13

## 范围（本 step 做/不做）

- 做：
  - Focus View 最小渲染（可先简化布局，不强制 D3）
  - Dialogue Stream：排序/分页/切换
- 不做：
  - 发言输入（Step 15）
  - 投票（Step 15）
  - SSE 订阅（Step 15）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite W — Web 端到端验收：W2）。

- [ ] `TopicPage`：
  - 初次渲染会请求 tree
  - tree 返回后渲染根节点与前 3 层
- [ ] 点击节点：
  - 请求 children（带 `orderBy/beforeId/limit`）
  - 切换 `orderBy` 会重置 `beforeId` 并重新加载
  - “加载更多”会使用 `nextBeforeId` 拉取下一页且不重复
- [ ] pruned 不可见：当 API 返回不含 pruned 时，UI 不应凭空渲染 pruned 占位

### 服务器验收（推荐 Playwright，黑盒）

- [ ] 部署 API/Web：`coolify deploy name <api_app_name>`、`coolify deploy name <web_app_name>`
- [ ] 进入 `/topics/:topicId`：首屏能渲染 tree(depth=3)
- [ ] 点击任一节点：Dialogue Stream 出现并能切换 `最新/最热` 与分页

建议用 MSW/mock fetch 来写组件测试，避免依赖真实 API。

## 2) Green：最小实现（让测试通过）

- `apps/web`：
  - 详情页 data fetching（可用 server components 或 client fetch，但要固定一种）
  - Focus View：先渲染为层级列表/简化树（后续可替换为直角连线布局）
  - Dialogue Stream：列表 + 排序切换 + “加载更多”

## 3) Refactor：模块化与收敛

- [ ] Focus View/Dialogue Stream 拆成独立组件与 hooks（`useTopicTree`/`useChildren`）
- [ ] 为后续 D3 替换保留数据结构边界（UI 不依赖后端的查询形状细节）

## 4) 验收

- 命令
  - 服务器验收（推荐）：`coolify deploy name <api_app_name>`、`coolify deploy name <web_app_name>`
  - 本地快速反馈（可选）：
    - `pnpm -C apps/web test`
    - `pnpm -C apps/web dev`
- 验收点
  - [ ] tree + children 两条读路径可用
  - [ ] “最新/最热”切换与分页正常
