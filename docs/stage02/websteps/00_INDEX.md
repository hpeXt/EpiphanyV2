# Web 前端 P5 风格重构实施索引

> 基于 `UX_UI_PLAN.md` 的详细实施步骤

## 当前状态审计

### 已有组件
- ✅ P5Button (variants: primary/ink/ghost/danger)
- ✅ P5Card, P5Panel
- ✅ P5Tabs
- ✅ P5Alert
- ✅ P5Badge
- ✅ P5Input, P5Textarea
- ✅ P5Shell (顶部导航 + 主容器)
- ✅ P5ToastProvider, P5ConfirmProvider
- ✅ CallingCard (基础版)
- ✅ TiptapRenderer

### 已有页面
- ✅ `/topics` - TopicList
- ✅ `/topics/new` - CreateTopicForm
- ✅ `/topics/[topicId]` - TopicPage (单栏布局)
- ✅ `/my` - MyActivity
- ⚠️ `/` - 重定向到 `/topics` (需改为旭日图首页)

### 已有可视化
- ✅ FocusView (树形)
- ✅ SunburstView (单 Topic 旭日图)
- ✅ GodView (语义地图)

### 待实现
- ❌ P5Slider (投票核心组件)
- ❌ P5Modal (统一弹窗)
- ❌ P5Skeleton (加载骨架)
- ❌ 首页旭日图 (议题宇宙)
- ❌ Topic 详情页双栏布局
- ❌ 身份区域 (助记词遮罩/揭示)
- ❌ 动效系统 (shake/stamp/pop)

---

## 实施阶段

| Phase | 文件 | 内容 | 预估工作量 |
|-------|------|------|-----------|
| 0 | `01_PHASE0_INFRA.md` | 字体加载、CSS 变量完善、动效基础 | 0.5 天 |
| 1 | `02_PHASE1_COMPONENTS.md` | P5Slider、P5Modal、P5Skeleton | 1-2 天 |
| 2 | `03_PHASE2_LAYOUT.md` | Topic 双栏布局、TopBar 改造 | 1-2 天 |
| 3 | `04_PHASE3_HOMEPAGE.md` | 首页旭日图（议题宇宙） | 1-2 天 |
| 4 | `05_PHASE4_IDENTITY.md` | 身份区域、助记词遮罩/揭示 | 1 天 |
| 5 | `06_PHASE5_MOTION.md` | 动效系统、仪式感交互 | 1 天 |
| 6 | `07_PHASE6_POLISH.md` | 可视化提升、错误处理、验收 | 1-2 天 |

---

## 依赖关系

```
Phase 0 (基础设施)
    │
    ├──▶ Phase 1 (核心组件)
    │        │
    │        ├──▶ Phase 2 (页面架构)
    │        │        │
    │        │        └──▶ Phase 3 (首页旭日图)
    │        │
    │        └──▶ Phase 4 (身份系统)
    │
    └──▶ Phase 5 (动效系统)
              │
              └──▶ Phase 6 (收口验收)
```

---

## 快速开始

```bash
# 1. 确保依赖安装
pnpm install

# 2. 启动开发服务器
pnpm -C apps/web dev

# 3. 按 Phase 顺序实施
```

---

## 文件结构预览

```
apps/web/
├── app/
│   ├── page.tsx              # Phase 3: 改为首页旭日图
│   ├── layout.tsx            # Phase 0: 字体加载
│   ├── globals.css           # Phase 0: CSS 变量 + 动效
│   ├── topics/
│   │   ├── page.tsx          # Phase 2: TopicList 简化
│   │   └── [topicId]/
│   │       └── page.tsx      # Phase 2: 双栏布局
│   └── my/
│       └── page.tsx          # Phase 4: 身份区域
├── components/
│   ├── ui/
│   │   ├── P5Slider.tsx      # Phase 1: 新增
│   │   ├── P5Modal.tsx       # Phase 1: 新增
│   │   ├── P5Skeleton.tsx    # Phase 1: 新增
│   │   └── ...
│   ├── home/
│   │   └── TopicUniverse.tsx # Phase 3: 新增
│   └── topics/
│       ├── TopicPage.tsx     # Phase 2: 双栏重构
│       └── ...
└── lib/
    └── ...
```
