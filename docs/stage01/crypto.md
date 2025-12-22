# Crypto 模块设计（`packages/crypto`，v1.0）

本文档定义 **AI 思想市场（The Thought Market）** 的本地密钥体系与请求签名规范，作为：

- `apps/web`：助记词/密钥派生、签名 headers 生成、用户指纹展示
- `apps/api`：签名验签、canonical message 计算、风控（timestamp/nonce）
- （可选）`apps/ai-worker`：如需访问私密读接口，按同一规范验签/签名（或仅在 API 内部调用）

对齐文档：

- `docs/prd.md`：「2.5 身份与隐私」
- `docs/architecture.md`：「6. 鉴权与匿名性」
- `docs/api-contract.md`：「1. 鉴权与签名（Ed25519）」与各签名接口

---

## 0. 目标与非目标

### 0.1 目标

1. **Topic 级不可关联**：同一用户在不同 Topic 使用不同公钥；后端无法凭签名把 Topic A 与 Topic B 的身份关联起来。
2. **可恢复**：仅凭 BIP39 助记词（+可选 passphrase）可在任意设备恢复同一 Master Seed，并重新派生所有 Topic 身份。
3. **跨语言一致**：JS（Web/Node）与 Python 只要实现本文算法与编码规则，派生结果与签名验证必须一致。
4. **低复杂度**：不引入链上地址/复杂 HD 钱包路径；派生规则简单可审计。

### 0.2 非目标（v1.0 不做）

- 端到端加密私聊、内容加密存储
- 零知识证明 / 环签名 / group signature（匿名集合证明）
- Sybil 抵抗（它属于机制/风控层，不在 crypto 模块内解决）

---

## 1. 数据表示与编码约定（必须一致）

### 1.1 字节与 hex

- 所有“密钥材料/哈希/签名”内部使用 **bytes**（JS 用 `Uint8Array`，Node 用 `Buffer`，Python 用 `bytes`）。
- 对外传输（HTTP headers/JSON）统一用 **hex 小写**：
  - `pubkey`：32 bytes → 64 chars hex
  - `signature`：64 bytes → 128 chars hex
  - `sha256`：32 bytes → 64 chars hex

### 1.2 字符串编码与规范化

- 所有参与哈希/签名/HMAC 的字符串必须按 **UTF-8** 编码为 bytes。
- BIP39 PBKDF2 输入的 `mnemonic` 与 `passphrase` 必须做 **NFKD** 规范化（BIP39 标准要求）。

### 1.3 版本化与域分离（Domain Separation）

派生/签名使用显式版本号或前缀，避免未来升级时产生“同输入不同含义”的混淆：

- Topic 派生前缀：`thought-market-topic-v1:`
- Canonical message 版本：`v1`

---

## 2. Master Seed：BIP39 助记词

### 2.1 助记词生成

- 默认生成 **12 words**（128-bit entropy），UX 负担更低；如需更强，可提供 24 words 选项。
- wordlist：建议先用英文（BIP39 English），避免多语言输入法/空格兼容问题（可后续扩展）。

### 2.2 助记词 → Master Seed（64 bytes）

使用 BIP39 标准 PBKDF2：

- PRF：HMAC-SHA512
- iterations：2048
- dkLen：64 bytes
- salt：`"mnemonic" + passphrase`（两者均做 NFKD）

伪代码：

```text
masterSeed = PBKDF2_HMAC_SHA512(
  password = NFKD(mnemonic),
  salt = NFKD("mnemonic" + passphrase),
  iterations = 2048,
  dkLen = 64
)
```

约束：

- v1.0 默认 `passphrase=""`（空字符串），但实现必须保留参数以便未来支持“高级用户加盐”。
- `masterSeed` **永不出端**（不写入任何请求体/日志/监控）。

---

## 3. Topic 影子身份派生（HMAC-SHA512 → Ed25519）

### 3.1 输入

- `masterSeed`：64 bytes（来自 BIP39）
- `topicId`：UUID v7 字符串（来自 API 返回）

`topicId` 处理规则：

- 使用 **API 返回的原始字符串**（建议先 `toLowerCase()`，但前后端必须保持一致）
- 不做额外 parse/re-format（避免丢失前导 0 / 大小写差异）

### 3.2 派生公式（规范）

```text
topicKeyMaterial = HMAC_SHA512(
  key = masterSeed,
  data = "thought-market-topic-v1:" + topicId   // UTF-8
)

ed25519Seed = topicKeyMaterial[0:32]            // 前 32 bytes
ed25519Keypair = Ed25519.KeypairFromSeed(ed25519Seed)
```

输出：

- `ed25519Seed`：32 bytes（私钥种子）
- `pubkey`：32 bytes（Topic 身份公钥）

说明：

- `topicKeyMaterial` 64 bytes 的后 32 bytes（`[32:64]`）在 v1.0 不使用；可保留作为未来派生“本地加密 key/额外用途”的空间，但严禁复用同一 key 做不同语义而不加域分离。

---

## 4. 请求签名（Canonical Message v1）

签名目的：证明“某 Topic 内的某 pubkey”对某请求负责，后端只需要验签，不需要知道 master seed 或跨 Topic 关联。

### 4.1 需要签名的请求

以 `docs/api-contract.md` 为准（写请求 + 私密读 + batch item 级签名）。

### 4.2 Headers（v1.0）

与 `docs/api-contract.md` 对齐：

- `X-Pubkey`：hex（64 chars）
- `X-Signature`：hex（128 chars）
- `X-Timestamp`：Unix ms（number）
- `X-Nonce`：随机串（建议 base64url 或 hex；**禁止包含 `|`**）

Host 认领额外 header：

- `X-Claim-Token`：仅 `CLAIM_OWNER` 需要（服务端颁发，TTL 5~10min）

### 4.3 Canonical Message（v1.0）

拼接格式（字符串）：

```text
v1|METHOD|PATH|TIMESTAMP|NONCE|BODY_HASH
```

字段规则：

- `METHOD`：HTTP method 全大写（例如 `POST`）
- `PATH`：**不含域名、不含 query string**（例如 `/v1/topics/:id/ledger/me`）
- `TIMESTAMP`：`X-Timestamp` 的十进制字符串
- `NONCE`：`X-Nonce` 原样
- `BODY_HASH`：
  - 若 body 为空：`""`（空字符串）
  - 否则：`sha256(rawBodyString)` 的 hex（64 chars，**小写**）

注意：当 `BODY_HASH=""` 时，canonical message 的最后一段为空，因此字符串会以 `|` 结尾（实现必须保持一致）。

### 4.4 `rawBodyString` 的定义（强约束）

为避免“同一 JSON 对象在不同语言/库 stringify 输出不同”：

- 客户端签名时：必须对 **即将发送的请求体字符串** 做 `sha256`。
- 服务端验签时：必须对 **接收到的原始请求体 bytes**（未解析前）做 `sha256`。

禁止做法：

- 服务端把 JSON parse 后再 stringify 去 hash（会因为 key 顺序/空格/浮点格式导致不一致）。

实现提示（NestJS）：

- 需要在 body-parser 的 `verify` hook 中捕获 raw body（或使用能暴露 raw body 的中间件），存到 `req.rawBody`，用于 `BODY_HASH` 计算。

### 4.5 签名算法

- 算法：Ed25519（PureEdDSA）
- 参与签名的消息：`canonicalMessage` 的 UTF-8 bytes
- 输出签名：64 bytes

伪代码：

```text
canonical = join("|", [v1, METHOD, PATH, TS, NONCE, BODY_HASH])
signature = Ed25519.sign(privateKeySeed, UTF8(canonical))
```

---

## 5. 验签与防重放（服务端策略，v1.0）

crypto 模块只提供“可验签”的能力；防重放/幂等由 API 组合 Redis/DB 完成，但需要统一策略：

1. `X-Timestamp`：要求 `abs(now - ts) < 60s`
2. `X-Nonce`：
   - 去重：Redis 记录 nonce（TTL 60s）
   - 幂等（强写，如 `setVotes`）：Redis 以 `(pubkey, nonce)` 缓存 5 分钟并复用上次成功响应（见 `docs/api-contract.md`）

---

## 6. 推荐的 `packages/crypto` API 面（建议）

> 这里定义“将来要实现”的最小 API 面，便于前后端共用与测试；实现细节/依赖选型可在落地时决定。

### 6.1 Mnemonic

```ts
export type Mnemonic = string;

export function generateMnemonic(words?: 12 | 24): Mnemonic;
export function validateMnemonic(mnemonic: Mnemonic): boolean;
export function mnemonicToMasterSeed(mnemonic: Mnemonic, passphrase?: string): Uint8Array; // 64 bytes
```

### 6.2 Topic 身份

```ts
export type TopicId = string;
export type Hex = string;

export type TopicKeypair = {
  pubkeyHex: Hex;     // 64 hex chars
  privSeedHex: Hex;   // 64 hex chars (32 bytes) - 默认不对外暴露，除非明确需要
};

export function deriveTopicKeypair(masterSeed: Uint8Array, topicId: TopicId): TopicKeypair;
```

### 6.3 Canonical message & 签名 headers

```ts
export type SignInputV1 = {
  method: string;         // will be uppercased
  path: string;           // no query string
  timestampMs: number;    // Unix ms
  nonce: string;          // must not contain '|'
  rawBody?: string | null;
};

export function sha256HexOfUtf8(input: string): Hex;
export function canonicalMessageV1(input: SignInputV1): string;

export function signCanonicalMessageV1(privSeed: Uint8Array, canonical: string): Uint8Array; // 64 bytes
export function verifyCanonicalMessageV1(pubkey: Uint8Array, canonical: string, signature: Uint8Array): boolean;

export function makeSignedHeadersV1(args: {
  pubkeyHex: Hex;
  signatureHex: Hex;
  timestampMs: number;
  nonce: string;
  claimToken?: string;
}): Record<string, string>;
```

### 6.4 UI 指纹（可选）

用于 hover 卡片里的 “用户昵称/Hash” 展示，不是安全边界（仅展示用途）：

```ts
export function pubkeyFingerprint(pubkeyHex: Hex, length?: number): string; // e.g. "bc0f7493…0cc9"
```

---

## 7. 参考测试向量（必须可复现）

> 用于 JS/Python/未来实现的互验。以下向量由 Node.js `crypto`（PBKDF2/HMAC/SHA256/Ed25519）计算得到。

输入：

- `mnemonic`：`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`
- `passphrase`：`""`（空字符串）
- `topicId`：`0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11`

期望输出：

- `masterSeed`（64 bytes, hex）：
  - `5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4`
- `topicKeyMaterial`（64 bytes, hex）：
  - `bd923ee263d27b04fd56910eb07dc4c883b5f860625d188e0e14e95cb81c18d6f294b3296c6f8a3f1e11eecb5e4e3e74b0d9c88a2e89bddd5c86d723fdc7e8bd`
- `ed25519Seed`（32 bytes, hex）：
  - `bd923ee263d27b04fd56910eb07dc4c883b5f860625d188e0e14e95cb81c18d6`
- `pubkey`（32 bytes, hex）：
  - `bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9`

签名向量（canonical message v1）：

- `method`：`POST`
- `path`：`/v1/arguments/0193e3a6-0b7d-7a8d-9f2c-3c4d5e6f7a8b/votes`
- `timestampMs`：`1700000000000`
- `nonce`：`00010203`
- `rawBody`：`{"targetVotes":3}`

期望输出：

- `bodyHash`：
  - `a710cf2b3ca4d126a0a72fc6beb3361f095d68003f0c61d1f63ce762428858a1`
- `canonical`：
  - `v1|POST|/v1/arguments/0193e3a6-0b7d-7a8d-9f2c-3c4d5e6f7a8b/votes|1700000000000|00010203|a710cf2b3ca4d126a0a72fc6beb3361f095d68003f0c61d1f63ce762428858a1`
- `signature`（hex）：
  - `a1568952a961633375dc8ea9cc29378ceafec2b984bf475cd18fc2404c43e7d8e1b5a9e8a87b6fff2f9d20a40a35485fb7ec0a046b1338841fb975c302fbb30b`

---

## 8. 依赖选型建议（落地时）

为同时支持 Web/Node，且便于 deterministic keypair from seed：

- BIP39：`@scure/bip39`
- Hash/HMAC：`@noble/hashes`（`sha256` / `hmac` / `sha512`）
- Ed25519：`@noble/ed25519`

或（仅 Node）可用原生 `crypto`；但若要在浏览器复用同一实现，建议优先纯 TS/JS 方案。

---

## 9. 安全注意事项（必须遵守）

1. **永不记录助记词/seed**：日志、错误上报、analytics 一律禁止包含 `mnemonic/masterSeed/ed25519Seed`。
2. **助记词展示需二次确认**：与 `docs/prd.md`「备份/恢复」一致；默认不常驻展示。
3. **随机性来源**：nonce 必须来自 CSPRNG（浏览器 `crypto.getRandomValues` / Node `crypto.randomBytes`）。
4. **不要签 query string（v1.0）**：所有需要签名的请求尽量避免依赖 query；如未来必须签 query，需要引入 canonical query 规则并升级版本号（`v2`）。
