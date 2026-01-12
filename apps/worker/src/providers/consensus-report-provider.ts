/**
 * @file consensus-report-provider.ts
 * @description Consensus report providers (mock + OpenRouter external LLM)
 */

import type {
  ConsensusReportProvider,
  GenerateConsensusReportInput,
} from '../processors/consensus-report.js';

type ConsensusReportProviderType = 'mock' | 'openrouter';

const REPORT_META_START = '<!-- REPORT_META_START -->';
const REPORT_META_END = '<!-- REPORT_META_END -->';
const REPORT_META_START_RE = /<!--\s*REPORT_META_START\s*-->/i;
const REPORT_META_END_RE = /<!--\s*REPORT_META_END\s*-->/i;

function stanceLabel(stance: -1 | 0 | 1): 'oppose' | 'neutral' | 'support' {
  if (stance === -1) return 'oppose';
  if (stance === 1) return 'support';
  return 'neutral';
}

function buildSystemPrompt(promptVersion: string): string {
  // Default: TalkToTheCity-inspired longform
  if (promptVersion === 'consensus-report/v6-t3c-longform') {
    return [
      '你是一名“研究型写作”的共识报告分析师，读者是一群严肃讨论者与思想者。',
      '你的任务不是写宣传文案，而是把讨论材料重构成一份“可审计的长文报告”：',
      '- 读者能在宏观上把握：有哪些阵营/角色、在争什么、哪些地方已形成共识、下一步该问什么',
      '- 读者能在微观上追溯：每条关键判断来自哪些原文证据（用 [S#] 立刻回到来源）',
      '',
      '对标标准（TalkToTheCity 风格）：Theme/Topic 的长描述 + 大量原子 Claim + 每条 Claim 的原文 Quotes 证据。',
      '',
      '硬性事实与引用纪律（必须严格遵守）：',
      '1) 只能使用用户提供的 Sources（以及用户额外给出的 Coverage/Params 信息）；不要引入外部事实。',
      '2) 凡是关于讨论内容的断言（事实、归纳、评价、建议、因果、归因、预测），必须在句末紧跟 1 个或多个引用 [S#]。',
      '3) 不要输出 Sources 列表/参考文献/脚注列表（产品会把 [S#] 渲染成脚注并链接回原文）。',
      '4) 不要输出任何内部 ID、URL 或不存在的引用；引用只能来自给定的 source labels（S1..Sn）。',
      '5) Quote 必须是对 source body 的“逐字短摘录”（1-3 句），用 Markdown blockquote（以 > 开头）输出，并在同一行末尾带 [S#]。',
      '6) 若需要提出推测/建议，必须写清楚前提条件，并用来源解释该建议的动机或风险点 [S#]。',
      '',
      '输出必须是中文 Markdown，并且在最开始包含一个可机器解析的 JSON 元数据块（用于 Bridge Statement 卡片）。',
      '',
      '元数据块格式（必须严格遵守）：',
      `- 第一行必须是：${REPORT_META_START}`,
      '- 然后紧跟一个 ```json 代码块，内容是严格 JSON（不要加注释，不要加尾逗号）',
      `- 然后紧跟一行：${REPORT_META_END}`,
      '',
      'JSON 结构要求（必须包含且仅需以下两块；允许额外字段但不得包含 source 原文）：',
      '{',
      '  "bridges": {',
      '    "gallerySize": 3,',
      '    "galleryIds": ["B1","B2","B3"],',
      '    "statements": [',
      '      { "id": "B1", "text": "一句可签字的共识桥梁句…", "conditions": ["条件1","条件2"], "sourceLabels": ["S2","S4","S9"] }',
      '    ]',
      '  },',
      '  "share": { "featuredBridgeIds": ["B1","B2","B3"], "ogTitle": "...", "ogDescription": "...", "shareText": "..." }',
      '}',
      '',
      'Bridge Statements 约束：',
      '- bridges.statements 至少 7 条，最多 12 条',
      '- id 必须按 B1..B12 的格式（只允许 B + 数字）',
      '- 每条 sourceLabels 至少 3 个，且必须来自给定的 [S#] labels',
      '- bridge.text 必须是“可签字句子”，避免空泛套话；若是条件共识，conditions 必须具体且可操作/可验证',
      '',
      '报告正文必须在元数据块之后输出，并且必须包含以下章节（顺序可微调，但都要出现）：',
      '## 导读（How to read）',
      '## Executive Summary（8–12 条，全部带引用）',
      '## 讨论全景（Coverage & Caveats）— 可使用用户提供的 coverage 数字；本节可少量无引用',
      '## 角色图谱（Role Atlas）— 4–8 个角色，每个角色给：关切/价值框架、核心主张、核心反对、可接受条件（都要引用）',
      '## 关键张力（Key Tensions）— 2–5 条“分歧轴”，明确两端各自最强理由（都要引用）',
      '## 主题地图（Themes, TalkToTheCity-style）— 这是主体长文',
      '## 未决问题与下一步议程（Agenda）— 把分歧转成可继续推进的问题清单（都要引用）',
      '## 方法（Method, brief）— 只描述你如何从 sources 抽取主题/角色/主张；可少量无引用',
      '',
      '“主题地图”必须按严格格式输出，便于产品解析与读者导航：',
      '- 每个主题用三级标题：### T1 主题名 / ### T2 ...（至少 6 个主题；若 sources 很少可降到 4 个）',
      '- 每个主题先写 2–4 段“长描述”（每段 3–6 句，尽量每句末尾都有引用）',
      '- 然后列出该主题的原子 Claims：每条 Claim 用四级标题：#### C1 Claim 标题（每个主题至少 4 条 Claim）',
      '- 每条 Claim 下：',
      '  1) 先写一段 Claim 解释（2–4 句）并带引用 [S#]',
      '  2) 再给 2–4 条 Quotes，用 > 开头逐字摘录并带 [S#]',
      '  3) 最后写“反例/反驳/边界条件”小段（至少 1 句）并带引用 [S#]',
      '',
      '写作风格：',
      '- 避免空泛形容词（“很重要/显然/大家都”）；用具体机制、条件、边界、反例来写',
      '- 允许保留不确定性，但要说清楚“不确定在哪里、需要什么证据” [S#]',
      '- 尽量覆盖不同立场/层级（可利用 votes/depth/stance 提示），不要只写同温层',
    ].join('\n');
  }

  // Fallback: treat unknown versions as the longform prompt.
  return buildSystemPrompt('consensus-report/v6-t3c-longform');
}

function getConsensusReportProviderType(): ConsensusReportProviderType {
  const explicit = process.env.REPORT_PROVIDER?.toLowerCase();
  if (explicit === 'openrouter' || explicit === 'real') return 'openrouter';

  const fallback = process.env.AI_PROVIDER?.toLowerCase();
  if (fallback === 'openrouter' || fallback === 'real') return 'openrouter';

  // If an OpenRouter key is present, prefer the real provider by default.
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';

  return 'mock';
}

export function createConsensusReportProvider(): ConsensusReportProvider {
  const providerType = getConsensusReportProviderType();
  console.log(`[worker] Using consensus report provider: ${providerType}`);

  switch (providerType) {
    case 'openrouter':
      return createOpenRouterConsensusReportProvider();
    case 'mock':
      return createMockConsensusReportProvider();
    default:
      return assertNever(providerType);
  }
}

function createMockConsensusReportProvider(): ConsensusReportProvider {
  return {
    async generate(input: GenerateConsensusReportInput) {
      const bridgeStatements = [
        {
          id: 'B1',
          text: '在不争论立场对错的前提下，先把关键术语与评估指标定义清楚，可以显著降低误解与无效争吵。',
          conditions: ['明确术语定义', '给出可复查的评估指标'],
          sourceLabels: input.sources.slice(0, 3).map((s) => s.label),
        },
        {
          id: 'B2',
          text: '在形成强结论前，应优先补齐对“最主要风险/收益”的可验证证据与反例清单。',
          conditions: ['列出最关键证据缺口', '明确反例将如何推翻结论'],
          sourceLabels: input.sources.slice(1, 4).map((s) => s.label),
        },
        {
          id: 'B3',
          text: '将分歧拆解为“事实不确定 / 价值冲突 / 约束不同”，有助于把讨论推进到可行动的下一步。',
          conditions: [],
          sourceLabels: input.sources.slice(2, 5).map((s) => s.label),
        },
        {
          id: 'B4',
          text: '如果双方都承认存在外部性，那么争议应聚焦于“干预边界与退出机制”，而不是否认问题本身。',
          conditions: ['明确边界', '明确退出机制'],
          sourceLabels: input.sources.slice(0, 2).map((s) => s.label),
        },
        {
          id: 'B5',
          text: '即使对长期趋势判断不同，也可以先在短期建立可逆的小规模试点，以降低决策不可逆风险。',
          conditions: ['小规模试点', '可逆/可回滚设计'],
          sourceLabels: input.sources.slice(3, 6).map((s) => s.label),
        },
        {
          id: 'B6',
          text: '对“转型成本”的分歧，可以通过明确分摊机制（谁承担、承担多久）来转化为可讨论的政策设计问题。',
          conditions: ['明确分摊对象', '明确时间窗口'],
          sourceLabels: input.sources.slice(4, 7).map((s) => s.label),
        },
        {
          id: 'B7',
          text: '在讨论政策强弱之前，先对“最坏情况/最好情况”的可接受边界达成一致，有助于形成共同底线。',
          conditions: ['明确可接受边界', '明确最坏情况应对'],
          sourceLabels: input.sources.slice(5, 8).map((s) => s.label),
        },
      ].filter((b) => b.sourceLabels.length);

      const reportMeta = {
        bridges: {
          gallerySize: 3,
          galleryIds: bridgeStatements.slice(0, 3).map((b) => b.id),
          statements: bridgeStatements,
        },
        share: {
          featuredBridgeIds: bridgeStatements.slice(0, 3).map((b) => b.id),
          ogTitle: `${input.topicTitle} · 共识报告`,
          ogDescription: '（mock）基于讨论内容生成的共识桥梁与分歧结构摘要。',
          shareText: `【共识报告】${input.topicTitle}\n\n${bridgeStatements[0]?.text ?? ''}`.trim(),
        },
      };

      const bulletLines = input.sources
        .slice(0, 10)
        .map((source) => {
          const title = source.title?.trim() ? ` — ${source.title.trim()}` : '';
          const excerpt = source.body.trim().slice(0, 160).replaceAll('\n', ' ');
          return `- (${source.totalVotes} votes)${title}: ${excerpt}${source.body.length > 160 ? '…' : ''} [${source.label}]`;
        })
        .join('\n');

      const contentMd = [
        '<!-- REPORT_META_START -->',
        '```json',
        JSON.stringify(reportMeta, null, 2),
        '```',
        '<!-- REPORT_META_END -->',
        '',
        '# 共识报告（mock）',
        '',
        `Topic: ${input.topicTitle}`,
        '',
        '## 输入摘要（Top sources）',
        '',
        bulletLines || '- (no sources)',
        '',
        '## 结论（mock）',
        '',
        '- 这是 mock 报告内容；线上会用外部模型生成更详细版本。 [S1]',
      ].join('\n');

      return { contentMd, model: 'mock-report-model' };
    },
  };
}

function createOpenRouterConsensusReportProvider(): ConsensusReportProvider {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (process.env.REPORT_MODEL ?? 'deepseek/deepseek-chat-v3-0324').trim();
  const timeoutMs = Number(process.env.REPORT_TIMEOUT_MS ?? '900000');
  const temperature = Number(process.env.REPORT_TEMPERATURE ?? '0.2');
  const maxTokens = Number(process.env.REPORT_MAX_TOKENS ?? '50000');
  const maxAttempts = Number(process.env.REPORT_MAX_ATTEMPTS ?? '2');
  const openRouterHttpReferer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const openRouterTitle = process.env.OPENROUTER_TITLE?.trim();

  return {
    async generate(input: GenerateConsensusReportInput) {
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for REPORT_PROVIDER=openrouter');
      }

      const systemPrompt = buildSystemPrompt(input.params.promptVersion);
      const sourceLabels = input.sources.map((s) => s.label);

      const sourcesBlock = input.sources
        .map((s) => {
          const title = s.title?.trim() ? s.title.trim() : '(no title)';
          const depthText = typeof s.depth === 'number' && Number.isFinite(s.depth) ? String(s.depth) : 'null';
          return [
            `[${s.label}] votes=${s.totalVotes} depth=${depthText} stance=${stanceLabel(s.stance)}`,
            `title: ${title}`,
            'body:',
            s.body.trim(),
          ].join('\n');
        })
        .join('\n\n---\n\n');

      const userPrompt = [
        `Topic: ${input.topicTitle}`,
        '',
        `Coverage: argumentsIncluded=${input.coverage.argumentsIncluded}/${input.coverage.argumentsTotal}, votesIncluded=${input.coverage.votesIncluded}/${input.coverage.votesTotal}`,
        `Selection: strategy=${input.params.selection.strategy}, maxSources=${input.params.selection.maxSources}, maxCharsPerSource=${input.params.selection.maxCharsPerSource}, topVotesK=${input.params.selection.topVotesK}, minPerBucket=${input.params.selection.minPerBucket}`,
        '',
        'Sources:',
        sourcesBlock || '(no sources)',
        '',
        '请按 system prompt 的格式输出：先 REPORT_META 的 JSON 元数据块，再输出 Markdown 报告正文。再次强调：每一个观点都要紧跟 [S#] 引用。',
      ].join('\n');

      const attempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : 2;

      let lastValidationError: Error | null = null;
      let feedback: string | null = null;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const messages: Array<{ role: 'system' | 'user'; content: string }> = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ];
        if (feedback) messages.push({ role: 'user', content: feedback });

        const { contentMd, usedModel } = await callOpenRouterChatCompletion({
          baseUrl,
          apiKey,
          model,
          temperature,
          maxTokens,
          timeoutMs,
          messages,
          extraHeaders: {
            ...(openRouterHttpReferer ? { 'HTTP-Referer': openRouterHttpReferer } : {}),
            ...(openRouterTitle ? { 'X-Title': openRouterTitle } : {}),
          },
        });

        const validation = validateLongformReport({
          contentMd,
          sourceLabels,
          sourceCount: input.sources.length,
        });

        if (validation.ok) {
          return { contentMd, model: usedModel };
        }

        lastValidationError = new Error(`Consensus report did not pass quality gate: ${validation.reasons.join(' | ')}`);
        feedback = [
          '你上一版输出未通过质量门槛，请完全重写并严格遵守 system prompt 的格式。失败原因：',
          ...validation.reasons.map((r) => `- ${r}`),
          '',
          '强制要求：不要解释、不要道歉、不要输出本段反馈；你的输出必须从下一行第一字符开始：',
          REPORT_META_START,
          '```json',
          '{',
          '  "bridges": {',
          '    "gallerySize": 3,',
          '    "galleryIds": ["B1","B2","B3"],',
          '    "statements": [',
          '      { "id": "B1", "text": "...", "conditions": ["..."], "sourceLabels": ["S1","S2","S3"] }',
          '    ]',
          '  },',
          '  "share": { "featuredBridgeIds": ["B1","B2","B3"], "ogTitle": "...", "ogDescription": "...", "shareText": "..." }',
          '}',
          '```',
          REPORT_META_END,
          '',
          '## 导读（How to read）',
          '## Executive Summary',
          '## 讨论全景（Coverage & Caveats）',
          '## 角色图谱（Role Atlas）',
          '## 关键张力（Key Tensions）',
          '## 主题地图（Themes, TalkToTheCity-style）',
          '## 未决问题与下一步议程（Agenda）',
          '## 方法（Method, brief）',
          '',
          '并在每个 #### C# Claim 下至少输出 2 条以 `>` 开头的逐字 Quote（同一行末尾带 [S#]）。所有观点句末必须带 [S#] 引用。',
        ].join('\n');
      }

      throw lastValidationError ?? new Error('Consensus report did not pass quality gate');
    },
  };
}

async function callOpenRouterChatCompletion(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  extraHeaders?: Record<string, string>;
}): Promise<{ contentMd: string; usedModel: string }> {
  const url = `${params.baseUrl}/chat/completions`;
  const maxFetchAttempts = parsePositiveInt(process.env.OPENROUTER_FETCH_MAX_ATTEMPTS, 2);
  const baseRetryDelayMs = 750;

  for (let attempt = 1; attempt <= maxFetchAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
            ...(params.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model: params.model,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            messages: params.messages,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (attempt < maxFetchAttempts && isRetryableNetworkError(err)) {
          console.warn(
            `[consensus-report] OpenRouter network error (attempt ${attempt}/${maxFetchAttempts}) url=${url} model=${params.model}: ${formatErrorWithCause(err)}`,
          );
          await sleep(baseRetryDelayMs * attempt);
          continue;
        }

        throw new Error(`OpenRouter network error url=${url} model=${params.model}: ${formatErrorWithCause(err)}`, {
          cause: err instanceof Error ? err : undefined,
        });
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const message = `OpenRouter request failed url=${url} model=${params.model}: ${response.status} ${text || response.statusText}`;

        if (attempt < maxFetchAttempts && isRetryableHttpStatus(response.status)) {
          console.warn(`[consensus-report] ${message} (attempt ${attempt}/${maxFetchAttempts}) retrying...`);
          await sleep(baseRetryDelayMs * attempt);
          continue;
        }

        throw new Error(message);
      }

      const json = (await response.json()) as any;
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`OpenRouter returned empty content url=${url} model=${params.model}`);
      }

      const usedModel = typeof json?.model === 'string' ? json.model : params.model;
      const usage = json?.usage && typeof json.usage === 'object' ? json.usage : undefined;
      if (usage) {
        const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null;
        const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null;
        const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : null;
        const parts = [
          promptTokens !== null ? `prompt=${promptTokens}` : null,
          completionTokens !== null ? `completion=${completionTokens}` : null,
          totalTokens !== null ? `total=${totalTokens}` : null,
        ].filter((v): v is string => typeof v === 'string');
        if (parts.length) console.log(`[consensus-report] OpenRouter usage model=${usedModel}: ${parts.join(' ')}`);
      }

      return { contentMd: content, usedModel };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`OpenRouter request failed after ${maxFetchAttempts} attempts url=${url} model=${params.model}`);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function formatErrorWithCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const base = error.message || String(error);
  const cause = (error as any).cause;
  if (!cause) return base;

  if (cause instanceof Error) {
    const code = typeof (cause as any).code === 'string' ? String((cause as any).code) : null;
    const msg = cause.message || String(cause);
    return `${base} (cause: ${code ? `${code} ` : ''}${msg})`;
  }

  return `${base} (cause: ${String(cause)})`;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return false;

  const cause = (error as any).cause;
  const codeCandidate = cause && typeof cause === 'object' ? (cause as any).code : (error as any).code;
  const code = typeof codeCandidate === 'string' ? codeCandidate : null;
  if (!code) return false;

  return ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT'].includes(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeReportMeta(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return 'bridges' in value || 'share' in value;
}

function parseJsonObjectFromText(content: string): Record<string, unknown> | null {
  const fenced = content.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(content);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    // fallthrough
  }

  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sliced = content.slice(first, last + 1);
    try {
      const parsed = JSON.parse(sliced);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function extractReportMetaAndBody(contentMd: string): { meta: Record<string, unknown> | null; body: string } {
  const startMatch = REPORT_META_START_RE.exec(contentMd);
  if (startMatch && typeof startMatch.index === 'number') {
    const startIndex = startMatch.index;
    const startEndIndex = startIndex + startMatch[0].length;
    const endMatch = REPORT_META_END_RE.exec(contentMd.slice(startEndIndex));
    if (endMatch && typeof endMatch.index === 'number') {
      const endIndex = startEndIndex + endMatch.index;
      const endEndIndex = endIndex + endMatch[0].length;

      const before = contentMd.slice(0, startIndex).trimEnd();
      const between = contentMd.slice(startEndIndex, endIndex);
      const after = contentMd.slice(endEndIndex).trimStart();

      const parsed = parseJsonObjectFromText(between);
      const meta = parsed && looksLikeReportMeta(parsed) ? parsed : null;
      const body = [before, after].filter(Boolean).join('\n\n').trim();
      return { meta, body };
    }
  }

  const leadingJsonFence = contentMd.match(/^\s*```(?:json|jsonc)?\s*([\s\S]*?)\s*```\s*/i);
  if (leadingJsonFence) {
    const parsed = parseJsonObjectFromText(leadingJsonFence[0]);
    const meta = parsed && looksLikeReportMeta(parsed) ? parsed : null;
    if (meta) {
      const body = contentMd.slice(leadingJsonFence[0].length).trimStart();
      return { meta, body: body.trim() };
    }
  }

  return { meta: null, body: contentMd.trim() };
}

function validateLongformReport(params: {
  contentMd: string;
  sourceLabels: string[];
  sourceCount: number;
}): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  const extracted = extractReportMetaAndBody(params.contentMd);
  const meta = extracted.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    reasons.push('缺少或无法解析 REPORT_META JSON 元数据块');
  } else {
    const bridges = (meta as any).bridges;
    const statements = bridges?.statements;
    if (!Array.isArray(statements)) {
      reasons.push('REPORT_META.bridges.statements 缺失或格式错误');
    } else {
      const count = statements.length;
      if (count < 7) reasons.push(`Bridge Statements 数量不足（${count}/7）`);
      if (count > 12) reasons.push(`Bridge Statements 数量过多（${count}/12）`);
    }
  }

  const body = extracted.body;
  if (!body) reasons.push('报告正文为空');

  // Basic length gate (adaptive to material volume).
  const minChars =
    params.sourceCount >= 40 ? 9000 : params.sourceCount >= 24 ? 7000 : params.sourceCount >= 12 ? 4500 : 2500;
  if (body.length < minChars) reasons.push(`正文过短（${body.length}/${minChars} chars）`);

  // Required sections (soft-ish but helps avoid barebones output).
  const requiredHeadings = ['## 导读', '## Executive Summary', '## 角色图谱', '## 关键张力', '## 主题地图', '## 未决问题', '## 方法'];
  for (const h of requiredHeadings) {
    if (!body.includes(h)) reasons.push(`缺少章节：${h}`);
  }

  const themeMatches = [...body.matchAll(/^###\s+T\d+\b.*$/gm)];
  const minThemes = params.sourceCount >= 24 ? 6 : params.sourceCount >= 12 ? 4 : 3;
  if (themeMatches.length < minThemes) reasons.push(`主题数量不足（${themeMatches.length}/${minThemes}）`);

  const claimMatches = [...body.matchAll(/^####\s+C\d+\b.*$/gm)];
  const minClaimsPerTheme = params.sourceCount >= 24 ? 4 : params.sourceCount >= 12 ? 3 : 2;
  const minClaimsTotal = minThemes * minClaimsPerTheme;
  if (claimMatches.length < minClaimsTotal) reasons.push(`Claim 数量不足（${claimMatches.length}/${minClaimsTotal}）`);

  const quoteLines = [...body.matchAll(/^>\s+.*$/gm)];
  const quotesPerClaim = params.sourceCount >= 12 ? 2 : 1;
  const minQuotesTotal = Math.max(0, claimMatches.length * quotesPerClaim);
  if (quoteLines.length < minQuotesTotal) reasons.push(`Quote 数量不足（${quoteLines.length}/${minQuotesTotal}）`);

  const citations = [...body.matchAll(/\[(S\d+)\]/g)].map((m) => m[1] ?? null).filter((v): v is string => Boolean(v));
  const citationSet = new Set(params.sourceLabels);
  const invalid = citations.filter((label) => !citationSet.has(label));
  if (citations.length < Math.max(20, claimMatches.length * 2)) {
    reasons.push(`引用密度偏低（citations=${citations.length}）`);
  }
  if (invalid.length > 0) {
    const unique = Array.from(new Set(invalid)).slice(0, 5);
    reasons.push(`包含无效引用标签：${unique.join(', ')}`);
  }

  if (reasons.length) return { ok: false, reasons };
  return { ok: true };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider type: ${String(value)}`);
}
