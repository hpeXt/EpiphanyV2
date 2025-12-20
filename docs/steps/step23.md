# Step 23 — v1.2：风控增强 / Sybil 抵抗（最小可落地）

## 目标

在不破坏匿名性边界的前提下，增加最小可落地的风控：

- L2/L3：pubkey/IP 限流（返回 `429 RATE_LIMITED`）
- 可选：Hashcash/PoW（L1）
- Topic 内黑名单（L4，Host 管理）

来源：`docs/roadmap.md` v1.2、`docs/architecture.md` 6.1。

## 依赖

- Step 06、Step 21

## 范围（本 step 做/不做）

- 做：
  - 写接口限流：createArgument/setVotes/commands（最小集合）
  - 错误码与契约对齐
- 不做：
  - 复杂信誉系统/跨 topic 画像（违背匿名性目标）

## 1) Red：先写测试

- [ ] 同 IP 或同 pubkey 在时间窗内超限 → `429 RATE_LIMITED`
- [ ] 限流不影响公共读接口
- [ ] 被 topic 黑名单命中 → 写接口拒绝（错误码需固定）

## 2) Green：最小实现（让测试通过）

- Redis 计数器（滑动窗口或 fixed window，先简单）
- 黑名单存储（DB 表或 topic metadata，先选一种固化）

## 3) Refactor：模块化与收敛

- [ ] 限流策略可配置（不同 endpoint 不同阈值）
- [ ] 记录最小可观测指标（被限流次数/原因），但避免记录可关联隐私

## 4) 验收

- 验收点
  - [ ] 高压请求下系统仍可用，且错误可预期

