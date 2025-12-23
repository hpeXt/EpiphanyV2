"use client";

import { useEffect } from "react";
import { createLocalStorageKeyStore } from "@/lib/signing";
import {
  generateMnemonic,
  mnemonicToMasterSeedHex,
} from "@/lib/identity";

/**
 * IdentityInitializer - 静默初始化身份
 * 首次访问时自动生成身份，用户无感知
 */
export function IdentityInitializer() {
  useEffect(() => {
    try {
      const keyStore = createLocalStorageKeyStore();
      const existingSeed = keyStore.getMasterSeedHex();

      // 如果已有身份，跳过
      if (existingSeed) return;

      // 静默创建新身份
      const mnemonic = generateMnemonic();
      const seedHex = mnemonicToMasterSeedHex(mnemonic);

      keyStore.setMasterSeedHex(seedHex);
      keyStore.setMnemonic(mnemonic);

      console.log("[Identity] Silent identity created");
    } catch (e) {
      console.error("[Identity] Failed to initialize:", e);
    }
  }, []);

  return null; // 无 UI
}
