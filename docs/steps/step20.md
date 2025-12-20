# Step 20 — Web：God View（语义地图可视化）（M6-语义地图 UI）

## 目标

把 `cluster-map` 渲染成可用的语义地图（先做“能看懂”，再做“好看”）：

- 拉取 `GET /v1/topics/:topicId/cluster-map`
- Canvas/WebGL 渲染散点
- 点大小：`weight=log(totalVotes+1)`；颜色：stance bucket；cluster 用背景/分区表达

来源：`docs/prd.md#2.1`、`docs/design.md`、`docs/roadmap.md` M6。

## 依赖

- Step 19

## 范围（本 step 做/不做）

- 做：
  - 最小可交互：缩放/平移/hover 信息卡（可简化）
  - 视觉编码不冲突：边框色=stance，cluster=区域/背景
- 不做：
  - 复杂等高线/材质系统（可后置增强）

## 1) Red：先写测试

对照全量规划：`docs/test-plan.md`（Suite W — Web 端到端验收：W6）。

- [ ] `GodView` 组件：
  - 能拉取并 parse `cluster-map`（用 shared-contracts）
  - API 返回空/错误时有降级提示
- [ ] hover 信息卡：给定点数据能渲染 Calling Card 样式（不要求最终美术，但结构需稳定）

## 2) Green：最小实现（让测试通过）

- `apps/web`：
  - 添加 God View 入口（按钮/切换）
  - 用 Canvas（先）渲染点；后续可换 Pixi/Three
  - hover 显示摘要：title/excerpt/totalVotes/stance/clusterId

## 3) Refactor：模块化与收敛

- [ ] 渲染引擎与数据层解耦（`useClusterMap` + renderer adapter）
- [ ] 为性能加入虚拟化/批渲染（>1000 点时仍可用，先预留）

## 4) 验收

> 前置：先按 `docs/coolify-target.md` export 环境变量（通用手册：`docs/coolify-acceptance.md`）。

### 服务器验收（推荐）

```bash
# 部署 API 和 Web
coolify deploy name "$API_APP_NAME" --force
coolify deploy name "$WEB_APP_NAME" --force
coolify app logs "$WEB_APP_UUID" -n 200
```

手动验收或 Playwright：

- [ ] 打开 `$WEB_BASE_URL` 并进入 God View
- [ ] 能看到点云（至少渲染出 >0 个点）
- [ ] hover 任一点：信息卡出现且不遮挡主要交互（缩放/平移仍可用）

验收点：

- [ ] >50 节点时 UI 可用，且 stance 与 cluster 编码不冲突
- [ ] pruning 后点不显示（依赖 API 已过滤）

### 本地快速反馈（可选）

```bash
pnpm -C apps/web test
```

验收点：

- [ ] 组件测试通过
