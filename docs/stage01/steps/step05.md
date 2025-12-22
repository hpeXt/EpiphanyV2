# Step 05 — `packages/crypto`：派生 + 签名 + canonical message（M4-签名 v1 基础）

## 目标

按 `docs/crypto.md` 与 `docs/api-contract.md#1` 落地签名 v1：Ed25519 + headers + canonical message，并用测试向量锁死跨端一致性。

## 依赖

- Step 02（可选：复用契约常量）

## 范围（本 step 做/不做）

- 做：
  - BIP39 助记词（生成/校验/转 master seed）
  - Topic 级 key 派生（HMAC-SHA512 → Ed25519 seed）
  - canonical message `v1|METHOD|PATH|TS|NONCE|sha256(rawBody)`（空 body 末尾 `|` 语义）
  - sign/verify（hex 编码输出）
- 不做：
  - 风控策略（timestamp window / nonce TTL / 幂等缓存属于 API 组合层）

## 1) Red：先写测试

### 测试向量（必须有）

- [ ] BIP39：对照公开 test vector（12 words + passphrase）得到固定 masterSeed（64 bytes）
  - mnemonic：`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`
  - passphrase：`TREZOR`
  - 期望 seed（hex，64 bytes）：
    - `c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04`
- [ ] BIP39（默认 passphrase=""）：同 mnemonic + 空 passphrase 的 seed 必须稳定（把期望值固化为 fixture）
- [ ] 派生：固定 `topicId` 下派生出的 `pubkey` 必须稳定（可把期望值写成 fixture）
- [ ] canonical message：
  - body 为空时 `BODY_HASH=""` 且 message 以 `|` 结尾
  - body 非空时 hash 来自 **raw body string**
- [ ] canonical message（细节）：
  - `METHOD` 必须全大写
  - `PATH` 不含 query string（`/v1/...`），且必须与实际请求路径逐字一致
  - 同一对象不同 stringify（空格/换行/字段顺序）必须产生不同 `BODY_HASH`
- [ ] sign/verify：同一 message 能通过验签；篡改任一字段验签失败
- [ ] 编码：`pubkey` 64 hex chars、`signature` 128 hex chars，且统一小写

建议落点：`packages/crypto/src/__tests__/*.test.ts`

## 2) Green：最小实现（让测试通过）

按 `docs/crypto.md#6` 建议 API 面实现（可按实际选型调整）：

- `generateMnemonic/validateMnemonic/mnemonicToMasterSeed`
- `deriveTopicKeypair(masterSeed, topicId)`
- `sha256Hex(rawBodyString)`
- `buildCanonicalMessage({ method, path, timestamp, nonce, bodyHash })`
- `signCanonicalMessage(seed32, canonicalMessage)`
- `verifyCanonicalMessage(pubkey32, canonicalMessage, signature64)`

## 3) Refactor：模块化与收敛

- [ ] 明确编码边界：内部 bytes、外部 hex（统一小写）
- [ ] 将 “canonical message 组装” 与 “HTTP headers 读写” 解耦（API/Web 都能复用）

## 4) 验收

> 前置：先按 `docs/coolify-target.md` export 环境变量（通用手册：`docs/coolify-acceptance.md`）。

### 服务器验收（推荐）

目的：保证签名实现与验收机的 API 验签口径一致。

```bash
# 部署 API（crypto 变更不应导致构建/启动失败）
coolify deploy name "$API_APP_NAME" --force
coolify app logs "$API_APP_UUID" -n 200

# （回归，需 Step 07 已完成）用脚本对 CLAIM_OWNER 发起签名请求并通过验签
node scripts/coolify/signed-request.mjs POST /v1/topics/<topicId>/commands \
  '{"type":"CLAIM_OWNER","payload":{}}' \
  --extra-header "X-Claim-Token: <claimToken>"
```

验收点：

- [ ] 部署成功，无构建/启动失败
- [ ] （回归）签名请求通过验签，不返回 `INVALID_SIGNATURE`

### 本地快速反馈（可选）

```bash
pnpm -C packages/crypto test
```

验收点：

- [ ] 测试向量稳定
- [ ] canonical message 与契约完全一致
