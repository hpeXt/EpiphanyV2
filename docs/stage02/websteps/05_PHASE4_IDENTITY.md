# Phase 4: 身份系统 UX

> 静默创建 + /my 页面助记词遮罩/揭示

## 4.1 概述

### 目标
实现 `UX_UI_PLAN.md` 第四部分定义的身份系统 UX

### 核心理念
- **静默创建**：首次访问自动生成身份，用户无感知
- **按需备份**：助记词默认遮罩，用户主动查看
- **安全优先**：30 秒自动隐藏，剪贴板自动清除

---

## 4.2 身份初始化改造

### 当前状态
`IdentityOnboarding.tsx` 会弹出 Modal 让用户选择创建/导入

### 目标状态
静默创建，无 Modal 干扰

### 实施步骤

#### Step 4.2.1: 修改身份初始化逻辑

修改 `apps/web/lib/identity.ts`：

```typescript
// 添加静默初始化函数
export function ensureIdentityExists(keyStore: KeyStore): boolean {
  try {
    const existing = keyStore.getMasterSeedHex();
    if (existing) return true;
  } catch {
    // 不存在，需要创建
  }

  // 静默创建
  try {
    const mnemonic = generateMnemonic();
    const seedHex = mnemonicToSeedSync(mnemonic).toString("hex");
    keyStore.setMasterSeedHex(seedHex);
    keyStore.setMnemonic(mnemonic);
    return true;
  } catch (e) {
    console.error("Failed to create identity:", e);
    return false;
  }
}
```

#### Step 4.2.2: 在根布局中初始化

创建 `apps/web/components/identity/IdentityInitializer.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { ensureIdentityExists } from "@/lib/identity";

export function IdentityInitializer() {
  useEffect(() => {
    const keyStore = createLocalStorageKeyStore();
    ensureIdentityExists(keyStore);
  }, []);

  return null; // 无 UI
}
```

修改 `apps/web/app/layout.tsx`:

```tsx
import { IdentityInitializer } from "@/components/identity/IdentityInitializer";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <IdentityInitializer />
        {/* ... */}
      </body>
    </html>
  );
}
```

---

## 4.3 /my 页面身份区域

### 实施步骤

#### Step 4.3.1: 创建助记词显示组件

创建 `apps/web/components/my/MnemonicDisplay.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { P5Button } from "@/components/ui/P5Button";

type Props = {
  mnemonic: string;
};

export function MnemonicDisplay({ mnemonic }: Props) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const words = mnemonic.split(" ");

  // 30 秒自动隐藏
  useEffect(() => {
    if (!isRevealed) return;

    const timer = setTimeout(() => {
      setIsRevealed(false);
    }, 30000);

    return () => clearTimeout(timer);
  }, [isRevealed]);

  // 复制功能
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopyStatus("copied");

      // 2 秒后恢复按钮状态
      setTimeout(() => setCopyStatus("idle"), 2000);

      // 30 秒后清除剪贴板
      setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === mnemonic) {
            await navigator.clipboard.writeText("");
          }
        } catch {
          // 忽略权限错误
        }
      }, 30000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }, [mnemonic]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm uppercase tracking-wide text-[color:var(--ink)]">
          助记词备份
        </h3>
        <div className="flex gap-2">
          <P5Button
            size="sm"
            variant="ghost"
            onClick={() => setIsRevealed(!isRevealed)}
          >
            {isRevealed ? "🙈" : "👁"}
          </P5Button>
          <P5Button
            size="sm"
            variant={copyStatus === "copied" ? "ink" : "ghost"}
            onClick={handleCopy}
            disabled={!isRevealed}
          >
            {copyStatus === "copied" ? "✓ 已复制" : "复制"}
          </P5Button>
        </div>
      </div>

      {/* 助记词卡片 */}
      <div
        className={`
          relative overflow-hidden
          border-[4px] border-[color:var(--ink)]
          transition-all duration-150
          ${isRevealed
            ? "bg-[color:var(--ink)] shadow-[var(--p5-shadow-md)]"
            : "bg-[color:var(--concrete-200)]"
          }
        `}
      >
        {isRevealed ? (
          // 明文显示
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {words.map((word, i) => (
              <div
                key={i}
                className="border-[2px] border-[color:var(--paper)] bg-[color:var(--ink)] px-2 py-1 text-center"
              >
                <span className="mr-1 font-mono text-xs text-[color:var(--paper)]/50">
                  {i + 1}.
                </span>
                <span className="font-mono text-sm text-[color:var(--paper)]">
                  {word}
                </span>
              </div>
            ))}
          </div>
        ) : (
          // 遮罩显示
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {words.map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-center gap-1 px-2 py-1"
              >
                {Array.from({ length: 4 }, (_, j) => (
                  <span
                    key={j}
                    className="h-2 w-2 rounded-full bg-[color:var(--ink)]/30"
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 自动隐藏倒计时（揭示时显示） */}
        {isRevealed && (
          <div className="border-t-[2px] border-[color:var(--paper)]/30 px-4 py-2 text-center text-xs text-[color:var(--paper)]/70">
            30 秒后自动隐藏
          </div>
        )}
      </div>

      {/* 警告提示 */}
      <div className="border-[3px] border-[color:var(--acid)] bg-[color:var(--paper)] p-3 text-sm">
        <div className="flex items-start gap-2">
          <span className="text-lg">⚠</span>
          <div>
            <p className="font-medium text-[color:var(--ink)]">
              助记词是恢复身份的唯一方式
            </p>
            <p className="mt-1 text-[color:var(--ink)]/70">
              清除浏览器数据或更换设备后，未备份将永久丢失
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### Step 4.3.2: 创建导入身份 Modal

创建 `apps/web/components/my/ImportIdentityModal.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { P5Modal } from "@/components/ui/P5Modal";
import { P5Button } from "@/components/ui/P5Button";
import { P5Textarea } from "@/components/ui/P5Textarea";
import { validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";

type Props = {
  open: boolean;
  onClose: () => void;
  onImport: (mnemonic: string) => void;
};

export function ImportIdentityModal({ open, onClose, onImport }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const words = input.trim().split(/\s+/).filter(Boolean);
  const isValidFormat = words.length === 12;
  const isValidMnemonic = isValidFormat && validateMnemonic(input.trim(), wordlist);

  // 预览地址
  const previewAddress = isValidMnemonic
    ? (() => {
        try {
          const seedHex = mnemonicToSeedSync(input.trim()).toString("hex");
          const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(seedHex, "preview");
          return `${pubkeyHex.slice(0, 8)}...${pubkeyHex.slice(-8)}`;
        } catch {
          return null;
        }
      })()
    : null;

  const handleImport = useCallback(() => {
    if (!isValidMnemonic) {
      setError("无效的助记词");
      return;
    }

    onImport(input.trim());
    setInput("");
    setError("");
    onClose();
  }, [input, isValidMnemonic, onImport, onClose]);

  return (
    <P5Modal
      open={open}
      onClose={onClose}
      title="IMPORT IDENTITY"
      footer={
        <>
          <P5Button variant="ghost" onClick={onClose}>
            取消
          </P5Button>
          <P5Button
            variant="primary"
            onClick={handleImport}
            disabled={!isValidMnemonic}
          >
            导入身份
          </P5Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block font-display text-sm uppercase tracking-wide">
            输入 12 个助记词（用空格分隔）
          </label>
          <P5Textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            placeholder="apple banana cherry ..."
            rows={4}
          />
        </div>

        {/* 验证状态 */}
        {input.trim() && (
          <div className="border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-3 text-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span>{isValidFormat ? "✓" : "✗"}</span>
                <span className={isValidFormat ? "" : "text-[color:var(--rebel-red)]"}>
                  格式{isValidFormat ? "正确" : "错误"} ({words.length}/12 个词)
                </span>
              </div>
              {isValidFormat && (
                <div className="flex items-center gap-2">
                  <span>{isValidMnemonic ? "✓" : "✗"}</span>
                  <span className={isValidMnemonic ? "" : "text-[color:var(--rebel-red)]"}>
                    校验和{isValidMnemonic ? "有效" : "无效"}
                  </span>
                </div>
              )}
              {previewAddress && (
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span>派生地址:</span>
                  <span>{previewAddress}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-[color:var(--rebel-red)]">{error}</div>
        )}

        {/* 警告 */}
        <div className="border-[3px] border-[color:var(--rebel-red)] bg-[color:var(--paper)] p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠</span>
            <div>
              <p className="font-medium text-[color:var(--ink)]">
                导入将覆盖当前设备上的身份
              </p>
              <p className="mt-1 text-[color:var(--ink)]/70">
                当前身份的投票记录将无法访问（除非再次导入）
              </p>
            </div>
          </div>
        </div>
      </div>
    </P5Modal>
  );
}
```

#### Step 4.3.3: 更新 MyActivity 页面

修改 `apps/web/components/my/MyActivity.tsx`：

```tsx
"use client";

import { useMemo, useState } from "react";
import { MnemonicDisplay } from "@/components/my/MnemonicDisplay";
import { ImportIdentityModal } from "@/components/my/ImportIdentityModal";
import { P5Button } from "@/components/ui/P5Button";
import { P5Panel } from "@/components/ui/P5Panel";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";
// ... 其他现有 imports ...

export function MyActivity() {
  const keyStore = useMemo(() => createLocalStorageKeyStore(), []);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // 获取助记词
  const mnemonic = useMemo(() => {
    try {
      return keyStore.getMnemonic?.() || null;
    } catch {
      return null;
    }
  }, [keyStore]);

  // 获取主身份地址
  const masterAddress = useMemo(() => {
    try {
      const seedHex = keyStore.getMasterSeedHex();
      if (!seedHex) return null;
      const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(seedHex, "master");
      return `${pubkeyHex.slice(0, 8)}...${pubkeyHex.slice(-8)}`;
    } catch {
      return null;
    }
  }, [keyStore]);

  // 导入处理
  const handleImport = (newMnemonic: string) => {
    const seedHex = mnemonicToSeedSync(newMnemonic).toString("hex");
    keyStore.setMasterSeedHex(seedHex);
    keyStore.setMnemonic(newMnemonic);
    window.location.reload(); // 刷新以应用新身份
  };

  return (
    <div className="space-y-6">
      {/* 身份管理区域 */}
      <P5Panel
        header={
          <div className="bg-[color:var(--ink)] px-4 py-3 font-display text-lg uppercase tracking-wide text-[color:var(--paper)]">
            身份管理
          </div>
        }
      >
        <div className="space-y-6">
          {/* 当前身份 */}
          <div>
            <h3 className="mb-2 font-display text-sm uppercase tracking-wide text-[color:var(--ink)]">
              当前身份
            </h3>
            <div className="flex items-center gap-3 border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] p-3">
              {/* 指纹图标 */}
              <div className="flex gap-1">
                <span className="h-3 w-3 rounded-full bg-[color:var(--rebel-red)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--acid)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--electric)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--ink)]" />
              </div>
              <span className="font-mono text-sm">{masterAddress || "未设置"}</span>
            </div>
          </div>

          {/* 助记词 */}
          {mnemonic && <MnemonicDisplay mnemonic={mnemonic} />}

          {/* 导入按钮 */}
          <div className="border-t-[3px] border-[color:var(--concrete-200)] pt-4">
            <P5Button variant="ghost" onClick={() => setIsImportOpen(true)}>
              导入已有身份
            </P5Button>
            <p className="mt-2 text-sm text-[color:var(--ink)]/60">
              用于跨设备同步或恢复
            </p>
          </div>
        </div>
      </P5Panel>

      {/* ... 现有的已访问议题列表 ... */}

      {/* 导入 Modal */}
      <ImportIdentityModal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={handleImport}
      />
    </div>
  );
}
```

---

## 4.4 TopBar 身份指示器

### 实施步骤

#### Step 4.4.1: 创建身份指纹组件

创建 `apps/web/components/identity/IdentityFingerprint.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";

type Props = {
  pubkeyHex: string;
  showAddress?: boolean;
};

// 从 pubkey 派生颜色
function deriveColors(pubkeyHex: string): string[] {
  const colors = ["var(--rebel-red)", "var(--acid)", "var(--electric)", "var(--ink)"];
  const indices = pubkeyHex.slice(0, 8).match(/.{2}/g) || [];

  return indices.map((hex, i) => {
    const value = parseInt(hex, 16);
    return colors[value % colors.length];
  });
}

export function IdentityFingerprint({ pubkeyHex, showAddress = true }: Props) {
  const colors = useMemo(() => deriveColors(pubkeyHex), [pubkeyHex]);
  const shortAddress = `${pubkeyHex.slice(0, 6)}...`;

  return (
    <Link
      href="/my"
      className="flex items-center gap-2 border-[3px] border-[color:var(--paper)] bg-transparent px-2 py-1 transition-colors hover:bg-[color:var(--paper)]/10"
      title={`身份: ${pubkeyHex}`}
    >
      {/* 4 个彩色圆点 */}
      <div className="flex gap-0.5">
        {colors.map((color, i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      {/* 地址（可选） */}
      {showAddress && (
        <span className="hidden font-mono text-sm text-[color:var(--paper)] sm:inline">
          {shortAddress}
        </span>
      )}
    </Link>
  );
}
```

---

## 4.5 验收清单

- [ ] 身份静默创建
  - [ ] 首次访问自动生成身份
  - [ ] 无 Modal 弹出
  - [ ] LocalStorage 正确存储

- [ ] 助记词显示
  - [ ] 默认遮罩（圆点）
  - [ ] 点击 👁 揭示明文
  - [ ] 30 秒自动隐藏
  - [ ] 揭示态 Ink 背景 + Paper 文字

- [ ] 复制功能
  - [ ] 点击复制到剪贴板
  - [ ] 按钮显示"✓ 已复制"
  - [ ] 30 秒后自动清除剪贴板

- [ ] 导入功能
  - [ ] Modal 正确打开/关闭
  - [ ] 实时验证格式 (12 词)
  - [ ] 实时验证校验和
  - [ ] 预览派生地址
  - [ ] 导入成功后刷新

- [ ] 身份指纹
  - [ ] 4 个彩色圆点显示
  - [ ] 点击跳转 /my
  - [ ] Hover 显示完整地址

---

## 预计产出文件

```
apps/web/
├── app/
│   └── layout.tsx                    # 修改：添加 IdentityInitializer
├── components/
│   ├── identity/
│   │   ├── IdentityInitializer.tsx   # 新增
│   │   ├── IdentityFingerprint.tsx   # 新增
│   │   └── IdentityOnboarding.tsx    # 可删除或保留作 fallback
│   └── my/
│       ├── MnemonicDisplay.tsx       # 新增
│       ├── ImportIdentityModal.tsx   # 新增
│       └── MyActivity.tsx            # 修改
└── lib/
    └── identity.ts                   # 修改：添加 ensureIdentityExists
```
