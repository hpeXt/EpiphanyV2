# Phase 0: 基础设施

> 字体加载、CSS 变量完善、动效基础

## 0.1 字体配置

### 目标
按 `UX_UI_PLAN.md` 排版系统配置三种字体栈：
- **Display**: Bebas Neue (标题/标签)
- **Body**: LXGW WenKai (中文正文)
- **Mono**: JetBrains Mono (数据/代码)

### 实施步骤

#### Step 0.1.1: 下载字体文件

```bash
# LXGW WenKai 需要本地托管（Google Fonts 无此字体）
mkdir -p apps/web/public/fonts
# 从 https://github.com/lxgw/LxgwWenKai/releases 下载
# LXGWWenKai-Regular.ttf → apps/web/public/fonts/
```

#### Step 0.1.2: 修改 `app/layout.tsx`

```tsx
import { Bebas_Neue, JetBrains_Mono } from 'next/font/google'
import localFont from 'next/font/local'

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const lxgwWenKai = localFont({
  src: '../public/fonts/LXGWWenKai-Regular.ttf',
  variable: '--font-body',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${bebasNeue.variable} ${jetbrainsMono.variable} ${lxgwWenKai.variable}`}>
      <body className="antialiased font-body">
        {/* ... */}
      </body>
    </html>
  )
}
```

#### Step 0.1.3: 更新 `globals.css` 字体变量

```css
:root {
  /* 替换现有字体变量 */
  --font-display: var(--font-display), 'Oswald', system-ui;
  --font-body: var(--font-body), 'Noto Sans SC', system-ui;
  --font-mono: var(--font-mono), 'Courier New', monospace;
}

/* 字体工具类 */
.font-display {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.font-body {
  font-family: var(--font-body);
}

.font-mono {
  font-family: var(--font-mono);
}
```

---

## 0.2 CSS 变量完善

### 目标
补充 `globals.css` 中缺失的设计 tokens

### 实施步骤

#### Step 0.2.1: 添加缺失变量

在 `globals.css` 的 `:root` 中添加：

```css
:root {
  /* === 现有变量保留 === */

  /* === 新增：排版层级 === */
  --p5-font-size-h1: 48px;
  --p5-font-size-h2: 32px;
  --p5-font-size-h3: 24px;
  --p5-font-size-body: 16px;
  --p5-font-size-caption: 14px;
  --p5-font-size-data: 14px;

  --p5-line-height-h1: 1.1;
  --p5-line-height-h2: 1.2;
  --p5-line-height-h3: 1.3;
  --p5-line-height-body: 1.6;
  --p5-line-height-caption: 1.5;

  /* === 新增：投影层级 === */
  --p5-shadow-sm: 2px 2px 0 var(--ink);
  --p5-shadow-md: 4px 4px 0 var(--ink);
  --p5-shadow-lg: 6px 6px 0 var(--ink);
  --p5-shadow-xl: 8px 8px 0 var(--ink);

  /* === 新增：双层投影（选中态/重要元素） === */
  --p5-shadow-selected: 4px 4px 0 var(--rebel-red), 8px 8px 0 var(--ink);

  /* === 新增：斜切角 === */
  --p5-clip-card: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
  --p5-clip-badge: polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%);

  /* === 新增：动效时长 === */
  --p5-motion-micro: 50ms;       /* hover/press */
  --p5-motion-fast: 80ms;        /* 状态变化 */
  --p5-motion-normal: 120ms;     /* 内容出现 */
  --p5-motion-slow: 200ms;       /* 复杂动画 */
  --p5-motion-complex: 300ms;    /* shake/stamp */

  /* === 新增：缓动函数 === */
  --p5-ease-snap: cubic-bezier(0.22, 1, 0.36, 1);
  --p5-ease-bounce: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --p5-ease-out: ease-out;
}
```

---

## 0.3 动效基础

### 目标
定义全局动效 keyframes

### 实施步骤

#### Step 0.3.1: 添加核心动画

在 `globals.css` 末尾添加：

```css
/* ========================================
   P5 Motion System
   ======================================== */

/* Shake - 错误反馈 */
@keyframes p5-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px) rotate(-1deg); }
  40% { transform: translateX(8px) rotate(1deg); }
  60% { transform: translateX(-4px) rotate(-0.5deg); }
  80% { transform: translateX(4px) rotate(0.5deg); }
}

/* Pop - 出现动画 */
@keyframes p5-pop {
  0% {
    opacity: 0;
    transform: scale(0.9) rotate(-2deg);
  }
  70% {
    transform: scale(1.02) rotate(0.5deg);
  }
  100% {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}

/* Stamp - 印章盖下 (投票成功) */
@keyframes p5-stamp {
  0% {
    opacity: 0;
    transform: scale(2) rotate(-15deg);
  }
  50% {
    opacity: 1;
    transform: scale(1.1) rotate(5deg);
  }
  100% {
    transform: scale(1) rotate(0);
  }
}

/* Slide In - 抽屉/面板 */
@keyframes p5-slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes p5-slide-in-up {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Pulse - 数值更新 */
@keyframes p5-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

/* Skeleton 加载 */
@keyframes p5-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* 扇区生长（首页旭日图） */
@keyframes p5-sector-grow {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* ========================================
   Motion 工具类
   ======================================== */

.animate-shake {
  animation: p5-shake var(--p5-motion-complex) ease-in-out;
}

.animate-pop {
  animation: p5-pop var(--p5-motion-normal) var(--p5-ease-snap) forwards;
}

.animate-stamp {
  animation: p5-stamp var(--p5-motion-complex) var(--p5-ease-bounce) forwards;
}

.animate-slide-in-right {
  animation: p5-slide-in-right var(--p5-motion-slow) var(--p5-ease-out) forwards;
}

.animate-slide-in-up {
  animation: p5-slide-in-up var(--p5-motion-normal) var(--p5-ease-out) forwards;
}

.animate-pulse {
  animation: p5-pulse var(--p5-motion-slow) ease-in-out;
}

/* ========================================
   Reduced Motion 支持
   ======================================== */

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 0.4 材质纹理

### 目标
添加噪点/半调网点纹理支持

### 实施步骤

#### Step 0.4.1: 创建噪点 SVG

创建 `apps/web/public/textures/noise.svg`:

```svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <filter id="noise">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#noise)" opacity="0.09"/>
</svg>
```

#### Step 0.4.2: 添加纹理工具类

在 `globals.css` 添加：

```css
/* ========================================
   材质纹理
   ======================================== */

.texture-noise {
  position: relative;
}

.texture-noise::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url('/textures/noise.svg');
  background-repeat: repeat;
  opacity: var(--p5-noise-opacity);
  pointer-events: none;
  mix-blend-mode: overlay;
}

/* 半调网点（用于骨架屏） */
.texture-halftone {
  background-image: radial-gradient(var(--ink) 1px, transparent 1px);
  background-size: 4px 4px;
}

/* 对角条纹（用于骨架屏） */
.texture-stripes {
  background: repeating-linear-gradient(
    -45deg,
    var(--concrete-200),
    var(--concrete-200) 4px,
    var(--concrete-100) 4px,
    var(--concrete-100) 8px
  );
}
```

---

## 0.5 验收清单

- [ ] Bebas Neue 字体正确加载（DevTools Network 检查）
- [ ] LXGW WenKai 字体正确加载
- [ ] JetBrains Mono 字体正确加载
- [ ] CSS 变量在 `:root` 可用（DevTools Elements 检查）
- [ ] `.animate-shake` 动画生效
- [ ] `.animate-pop` 动画生效
- [ ] `.texture-noise` 显示噪点纹理
- [ ] `prefers-reduced-motion` 时动画禁用

---

## 预计产出文件

```
apps/web/
├── app/
│   ├── layout.tsx          # 修改：字体加载
│   └── globals.css         # 修改：变量 + 动效 + 纹理
└── public/
    ├── fonts/
    │   └── LXGWWenKai-Regular.ttf  # 新增
    └── textures/
        └── noise.svg               # 新增
```
