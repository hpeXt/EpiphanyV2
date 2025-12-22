# 安全审计方案（外部团队执行版）

> 目的：当你不信任原开发团队时，让另一支独立团队可以**可复现、可验证、可签收**地对本项目做全量安全审计，并产出可执行的整改清单与复测证据。

---

## 0. 约定与原则（必须先对齐）

### 0.1 审计基线（Baseline）

- 审计以**单一代码快照**为准（commit SHA / tag / release）。
- 项目方应冻结审计基线：审计过程中允许修复分支，但必须保留基线不变以便复现。
- 审计报告必须标注：基线 commit、运行环境、工具版本、扫描规则版本、复测 commit。

### 0.2 数据与权限最小化

- 审计只使用**staging 环境**与**自建测试数据**（创建新的 Topic/Argument），不要触碰真实用户数据。
- 任何密钥/Token 只给 staging 临时凭证，**可随时吊销**；审计方不应要求生产权限。

### 0.3 交付物必须“可验证”

- 每个问题必须包含：严重级别、影响面、复现步骤（命令/请求）、证据（响应/日志片段）、修复建议、复测结果。
- 所有自动化扫描输出要求提交原始产物（例如 SARIF/JSON/HTML），避免只给截图。

---

## 1. 审计范围（Scope）

### 1.1 代码与组件

- `apps/api`：鉴权/验签、读写接口、SSE、幂等、风控、错误口径、队列投递。
- `apps/worker`：BullMQ 任务、AI provider、聚类/报告、写回与事件、重试与幂等。
- `apps/web`：签名客户端、身份/存储、XSS/CSRF、SSE 订阅与刷新策略。
- `packages/*`：契约（`shared-contracts`）、业务逻辑（`core-logic`）、签名派生（`crypto`）、DB 客户端与迁移（`database`）。
- 部署与运行：`Dockerfile`、`docker-compose.yml`、`docs/deploy-coolify.md`、脚本 `scripts/*`。

### 1.2 关键安全目标（本项目的“必须一直成立”）

审计应以 `docs/roadmap.md` 的 0.x 硬约束为依据（包括但不限于）：

- 签名 v1：canonical message 规则、时间窗、nonce 去重、防重放。
- 幂等：`setVotes` 强幂等（重放返回一致成功响应）、写路径不可被风控误伤导致破坏幂等语义。
- 一致性：QV 账本不变量（余额/成本守恒、整数口径）。
- SSE：只推 invalidation，不得携带私密数据。
- 匿名性：后端不建立跨 Topic 的用户关联；IP 相关风控不得形成可关联画像。

---

## 2. 项目方需要提供的“审计包”（给外部团队）

### 2.1 只读代码快照

- Git 仓库只读权限（或导出 `git bundle`）。
- 基线 commit SHA（写在本文件的审计工单里）。
- `pnpm-lock.yaml`、`package.json`、所有 workspace 包的 `package.json`。

### 2.2 可复现的运行与测试入口

- 本地依赖启动：`docker compose up -d postgres redis`（见 `docker-compose.yml`）。
- 测试命令（按包）：
  - `pnpm -C packages/shared-contracts test`
  - `pnpm -C packages/core-logic test`
  - `pnpm -C packages/crypto test`
  - `pnpm -C packages/database test`（需要 Postgres）
  - `pnpm -C apps/api test && pnpm -C apps/api test:e2e`（需要 Postgres/Redis）
  - `pnpm -C apps/worker test`（需要 Postgres/Redis）
  - `pnpm -C apps/web test`
- 构建命令：`pnpm build`（turbo）。

### 2.3 Staging 环境信息（建议集中在 `docs/coolify-target.md`）

- Web/API/Worker 对外地址（只要 URL，不要 token）。
- 若提供 Coolify 访问：建议只读（或受限）账号 + 审计期间临时 token；到期自动撤销。

---

## 3. 快速验证（审计团队先把“可跑通”做实）

> 目标：在开始深度审计前，先证明“代码可构建、测试可跑、接口可达”，避免后续结论不可复现。

### 3.1 本地复现（推荐）

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres redis
pnpm build

pnpm -C packages/shared-contracts test
pnpm -C packages/core-logic test
pnpm -C packages/crypto test
pnpm -C packages/database test

pnpm -C apps/api test
pnpm -C apps/api test:e2e
pnpm -C apps/worker test
pnpm -C apps/web test
```

### 3.2 Staging 冒烟（黑盒）

以 `docs/coolify-target.md` 给出的 `API_BASE_URL/WEB_BASE_URL/WORKER_BASE_URL` 为准：

```bash
curl -fsS "$API_BASE_URL/health"
curl -fsS "$API_BASE_URL/v1/topics?limit=1"
curl -fsS "$WORKER_BASE_URL/health"
curl -sS -D - -o /dev/null --max-time 2 -H 'Accept: text/event-stream' "$API_BASE_URL/v1/sse/<topicId>" | head
```

---

## 4. 可执行路线图（Roadmap）

### Phase A — 资产清点 + 威胁模型（Threat Model）

1. 列出资产与信任边界（至少包含：Web、API、Worker、Postgres、Redis、外部 AI Provider、SSE 客户端）。
2. 画数据流（DFD）：签名头生成→API 验签→写库→事件→SSE→Web 刷新；Worker 队列→读库→外部调用→写回→事件。
3. 明确攻击面与威胁假设：匿名性边界、重放/签名绕过、SSE 泄露、DoS、供应链、prompt 注入/数据外传。

交付物：
- Threat Model 文档（图 + 威胁清单 + 优先级）。

### Phase B — 供应链与密钥卫生（SCA/Secrets/Licenses）

1. Secrets 扫描（必须覆盖 git 历史）：
   - `gitleaks detect --source . --no-git=false`
2. 依赖风险：
   - `pnpm audit`（可结合 Snyk/OSV）
3. SBOM 输出（建议 CycloneDX）并做许可证检查。

交付物：
- secrets 扫描报告、依赖漏洞清单、SBOM、许可证风险说明。

### Phase C — 静态扫描（SAST）

1. CodeQL（推荐，能产 SARIF）或 Semgrep（规则需版本锁定）：
   - 关注：注入、路径拼接、反序列化、SSRF、XSS、鉴权缺陷、敏感信息日志。
2. TypeScript/Nest/Next 特定规则（例如：不安全的 `dangerouslySetInnerHTML`、不受控 markdown 渲染、header 信任链）。

交付物：
- SAST 原始输出（SARIF/JSON）+ 规则版本。

### Phase D — 人工代码审查（高风险模块清单）

> 人工审查优先级应高于“全文件平均扫一遍”。

必审模块（建议逐项出 checklist）：

1. 签名与防重放（`packages/crypto` + API guard/interceptor）：
   - canonical PATH 是否排除 query；raw body hash 是否一致；nonce 是否禁止 `|`；timestamp window 是否正确；重放语义是否符合契约。
2. `setVotes` 与资金不变量（`packages/core-logic` + API 写路径事务）：
   - 事务边界、并发下不变量、幂等缓存、余额不足处理、整数口径。
3. SSE 与事件（API 事件生产 + `GET /v1/sse/:topicId`）：
   - 是否只推 invalidation；是否剥离私密字段；`Last-Event-ID` 续传与 trimmed 处理。
4. 风控（Step 23）：限流/黑名单：
   - IP 是否哈希且 salt 不可默认用于生产；公共读不受影响；错误码与重试头一致；不破坏 `setVotes` 幂等重放语义。
5. Worker（Step 18/19/22）：任务幂等、重试、写回：
   - jobId 设计、重复写入防抖/覆盖语义、外部调用超时与失败处理、日志是否泄密。
6. Web 安全：
   - markdown 渲染/XSS、CSP/安全头、签名私钥存储策略、SSE 重连与刷新策略。
7. DB 约束与迁移：
   - 关键约束是否在 DB 层锁死；索引；pgvector 维度；敏感字段类型与长度校验。

交付物：
- 人工审查记录（逐项结论 + 证据链接到代码位置 + 风险说明）。

### Phase E — 动态测试（DAST + 业务攻击用例）

1. DAST（OWASP ZAP/Burp）跑 Web 与 API：
   - 重点：鉴权绕过、错误信息泄露、CORS、缓存头、SSE 长连接。
2. 业务攻击用例（建议形成脚本化回归）：
   - 重放攻击：复用 nonce 是否得到 `409 NONCE_REPLAY`（除 `setVotes` 特例）；
   - 签名篡改：METHOD/PATH/TS/NONCE/BODY 任一篡改应失败；
   - `setVotes` 幂等：同 nonce 重放返回一致成功响应；
   - SSE：事件 payload 中不应出现 ledger/stakes 等私密信息；
   - 风控：写接口 429 但公共读不受影响；`Retry-After` 合理；黑名单错误码固定。

交付物：
- DAST 报告 + 关键业务用例的可复现脚本/命令。

### Phase F — 部署与运行配置审计（Docker/Coolify/Runtime）

1. 镜像与 Dockerfile：最小权限、只读文件系统（可选）、依赖固定、避免把 `.env` 打进镜像。
2. 网络暴露：DB/Redis 不应对公网开放；仅 API/Web 暴露；Worker 入口若暴露需最小化。
3. 运行时安全：安全响应头、CORS、速率限制、日志与追踪不泄密、备份与密钥轮换策略。

交付物：
- 配置风险清单（可操作的修改建议）。

### Phase G — 报告、修复、复测、签收（Gate）

1. 输出问题清单（按 Critical/High/Medium/Low），并给出复现步骤与修复建议。
2. 修复后复测：审计方必须对每个已修复问题给出“复测证据”（命令/响应/日志）。
3. 签收门槛建议（可按组织策略调整）：
   - 上线前：Critical=0；High=0；中低危允许有风险接受但需书面记录。

---

## 5. 严重级别建议（用于审计方统一口径）

- **Critical**：可未授权写入/读到私密数据；签名/重放绕过；QV 资金不变量可破坏；RCE；关键密钥泄露。
- **High**：可导致大范围 DoS、越权访问某类资源、敏感信息可被推断关联、严重 XSS。
- **Medium/Low**：最佳实践缺失、潜在风险、低影响信息泄露、可用性瑕疵等。

---

## 6. 附录：项目内参考文档

- 架构与硬约束：`docs/architecture.md`、`docs/roadmap.md`
- API 契约：`docs/api-contract.md`
- DB 语义：`docs/database.md`
- 签名规则：`docs/crypto.md`
- Worker：`docs/ai-worker.md`
- Coolify 目标环境：`docs/coolify-target.md`
- Coolify 验收手册：`docs/coolify-acceptance.md`

