# Audit Step 15 — 报告/复测/签收 Gate：问题清单、复测证据、上线门槛

## 目标

- 把审计输出固化为可签收的“问题清单 + 复测证据”，并形成上线门槛（Gate）。
- 保证每个结论可复现：基线 commit、工具版本、规则版本、原始产物齐备。

## 输入 / 前置条件

- 已完成至少：Step 02（可复现构建）、Step 04~06（扫描产物）、Step 07~10（核心安全目标验证）。
- 参考口径：`docs/stage02/security-audit-plan.md`（严重级别建议与交付物要求）。

## 操作步骤

### 1) 整理“审计工单信息”（必须）

在报告开头固定以下字段（可直接复制模板）：

```md
## 审计基线
- baseline_commit: <SHA>
- audit_run_id: <YYYYMMDDTHHMMSSZ>
- environment: <local/staging>
- tool_versions: 见 env.txt

## 范围
- apps/api / apps/worker / apps/web / packages/*
- 部署：Docker/Compose/Coolify（如适用）

## 关键安全目标（必须一直成立）
- 签名 v1：canonical/path/raw body/timestamp/nonce
- setVotes：强幂等 + 资金不变量
- SSE：只推 invalidation，不泄露私密数据
- 匿名性：不建立跨 topic 关联；风控 IP 仅按 topic 哈希
```

### 2) 输出问题清单（每条必须可复现）

每条问题至少包含：

- 严重级别（Critical/High/Medium/Low）
- 影响面（组件/端点/数据）
- 复现步骤（命令/请求）
- 证据（响应/日志片段/扫描器原始条目）
- 修复建议（尽量给出最小修复）
- 复测结果（修复前后对比证据）

建议格式：

```md
### V-01 标题
- Severity: High
- Affected: apps/api, POST /v1/...
- Repro:
  - <commands>
- Evidence:
  - <file in audit-artifacts/...>
- Fix:
  - <patch idea>
- Retest:
  - <commands + evidence>
```

### 3) 复测（Retest）规则

- 修复必须在新 commit 上进行，并记录：`fix_commit`。
- 每个已修复问题必须给出“复测证据”（命令 + 响应/日志），并保存到 `audit-artifacts/`。

### 4) 签收 Gate（建议默认门槛）

按 `docs/stage02/security-audit-plan.md` 建议：

- 上线前：Critical = 0，High = 0
- Medium/Low：允许风险接受，但必须书面记录（含 owner 与到期时间）

## 通过标准（独立可验证）

- [ ] 报告包含基线与工具版本（引用 `audit-artifacts/.../env.txt`）。
- [ ] 每条问题都有可复现步骤与原始证据文件路径。
- [ ] 已修复问题有复测证据，并标注复测 commit。
- [ ] Gate 结论明确：是否可上线，若不可上线列出阻断项。

## 产物（证据）

- `audit-artifacts/<runId>-<sha>/report.md`（建议）
- `audit-artifacts/<runId>-<sha>/retest.md`（建议）
- 扫描产物：`*.sarif` / `*.json` / `*.html`

