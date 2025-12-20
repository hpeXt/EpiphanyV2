# Step 06 — API 基础能力：Prisma + Redis + 签名验签 + 错误口径（M2-写路径地基）

## 目标

让 `apps/api` 具备后续所有写接口复用的基础能力：

- 捕获 raw body（用于 `BODY_HASH`）
- 验签 + timestamp window + nonce 去重（Redis TTL 60s）
- 统一错误响应结构（对齐 `docs/api-contract.md#2.2`）

## 依赖

- Step 02（shared-contracts）
- Step 03（database）
- Step 05（crypto）

## 范围（本 step 做/不做）

- 做：
  - NestJS 中间件/guard：验签与风控
  - Redis nonce 去重（TTL 60s）
  - 统一错误响应
- 不做：
  - 任何业务接口（Topic/Argument/QV 在后续 step）

## 1) Red：先写测试

### API e2e（supertest）

- [ ] 未带签名访问“需要签名的接口”→ `401` + `INVALID_SIGNATURE`
- [ ] timestamp 超窗（abs(now-ts) >= 60s）→ `401` + `TIMESTAMP_OUT_OF_RANGE`
- [ ] nonce 重放 → `409` + `NONCE_REPLAY`
- [ ] bodyHash 使用 raw body：同一 JSON 对象不同空格/字段顺序会产生不同 hash（验签应严格基于 raw body）
- [ ] 错误响应结构固定为 `{ error: { code, message, details? } }`

建议先在 API 加一个“受保护的 dummy endpoint”（例如 `GET /v1/auth/ping`）用于专测鉴权层。
（推荐做法：只在 e2e TestingModule 里挂载测试用 controller，避免把非契约路由带到生产构建。）

## 2) Green：最小实现（让测试通过）

- `apps/api`：
  - raw body 捕获（Nest/Express body parser verify hook）
  - `AuthGuard`/middleware：
    - 读取 `X-Pubkey/X-Signature/X-Timestamp/X-Nonce`
    - 构造 canonical message（PATH 不含 query string）
    - Ed25519 verify
    - Redis 记录 nonce（TTL 60s）
  - 统一异常过滤器（Nest exception filter）输出契约错误结构

## 3) Refactor：模块化与收敛

- [ ] 把鉴权/验签相关逻辑下沉到可测试的 service（controller 不碰细节）
- [ ] 把错误码做成枚举/常量（优先复用 `shared-contracts`）

## 4) 验收

- 命令
  - `docker compose up -d postgres redis`
  - `pnpm -C apps/api test`（或 `test:e2e` 覆盖鉴权用例）
- 验收点
  - [ ] 任意后续“需要签名的写接口”都可复用该 guard（无需复制粘贴）
