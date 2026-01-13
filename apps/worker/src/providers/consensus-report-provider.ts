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
const CHAINED_PROMPT_VERSION = 'consensus-report/v7-stage03-chained';

function stanceLabel(stance: -1 | 0 | 1): 'oppose' | 'neutral' | 'support' {
  if (stance === -1) return 'oppose';
  if (stance === 1) return 'support';
  return 'neutral';
}

function buildFallbackConsensusReport(input: GenerateConsensusReportInput, opts?: { reason?: string }): string {
  const fallbackLabels = input.sources.slice(0, 3).map((s) => s.label);

  const bridges = [
    {
      id: 'B1',
      text: '在结论分歧较大时，先把关键术语、评价指标与可验证证据缺口对齐，再讨论立场与方案。',
      conditions: ['明确术语与指标', '列出证据缺口与反例'],
      sourceLabels: fallbackLabels,
    },
    {
      id: 'B2',
      text: '将分歧拆解为“事实不确定 / 价值冲突 / 约束不同”，有助于把争论转化为可推进的议程。',
      conditions: ['区分事实/价值/约束', '对每类分歧提出可验证问题'],
      sourceLabels: fallbackLabels,
    },
    {
      id: 'B3',
      text: '在缺乏决定性证据前，优先采用可逆的小规模试点，并明确退出机制与风险边界。',
      conditions: ['试点可回滚', '明确退出机制与边界条件'],
      sourceLabels: fallbackLabels,
    },
  ].filter((b) => b.sourceLabels.length);

  const reportMeta = {
    bridges: {
      gallerySize: 3,
      galleryIds: bridges.slice(0, 3).map((b) => b.id),
      statements: bridges,
    },
    share: {
      featuredBridgeIds: bridges.slice(0, 3).map((b) => b.id),
      ogTitle: `${input.topicTitle} · 共识报告`,
      ogDescription: '（降级）外部模型输出不可用时的最小可读报告。',
      shareText: `【共识报告】${input.topicTitle}\n\n${bridges[0]?.text ?? ''}`.trim(),
    },
    analysis: {
      kind: 'fallback',
      reason: opts?.reason ?? null,
    },
  };

  const bulletLines = input.sources
    .slice(0, 10)
    .map((source) => {
      const title = source.title?.trim() ? ` — ${source.title.trim()}` : '';
      const excerpt = source.body.trim().slice(0, 180).replaceAll('\n', ' ');
      return `- (${source.totalVotes} votes)${title}: ${excerpt}${source.body.length > 180 ? '…' : ''} [${source.label}]`;
    })
    .join('\n');

  const metaBlock = [REPORT_META_START, '```json', JSON.stringify(reportMeta, null, 2), '```', REPORT_META_END].join('\n');

  const reasonLine = opts?.reason ? `降级原因：${opts.reason}` : null;
  const body = [
    '## 导读（How to read）',
    reasonLine
      ? `本报告当前为降级输出（${reasonLine}）：提供输入摘要与最小结构提示，便于继续迭代生成更完整的长文版本。`
      : '本报告当前为降级输出：提供输入摘要与最小结构提示，便于继续迭代生成更完整的长文版本。',
    '',
    '## 输入摘要（Top sources）',
    '',
    bulletLines || '- (no sources)',
    '',
    '## 方法（Method, brief）',
    '基于选中的 Sources 做最小可读汇总；未进行 TalkToTheCity 风格的主题/主张/逐字引文展开。',
  ].join('\n');

  return [metaBlock, body].join('\n\n');
}

function buildChainedMetaSystemPrompt(): string {
  return [
    '你是一名“讨论材料结构化抽取器”，目标是生成可交互的 REPORT_META JSON。',
    '只输出严格 JSON（不要 Markdown、不要代码围栏、不要解释、不要道歉）。',
    '',
    '硬约束：',
    '1) 只能使用用户提供的 Sources（S1..Sn），不要引入外部事实。',
    '2) JSON 中不得包含任何 source 原文逐字摘录（不要粘贴引用句子）；只能写短摘要与标签引用。',
    '3) 需要引用来源时，用 sourceLabels 数组列出 ["S1","S2"]；不要在文本里写 [S#]。',
    '4) bridges / share 必须存在；允许额外输出 analysis 字段（roles/tensions/themes/claims/agenda）。',
  ].join('\n');
}

function buildChainedBodySystemPrompt(): string {
  return [
    '你是一名“研究型写作”的共识报告分析师。',
    '输出：中文 Markdown 报告正文（不要输出 REPORT_META、不要输出 JSON、不要输出 Sources 列表）。',
    '',
    '硬性事实与引用纪律：',
    '1) 只能使用用户提供的 Sources；不要引入外部事实与未经来源支持的具体数字。',
    '2) 关于讨论内容的关键断言，尽量在句末附 [S#] 引用；引用只能来自给定的 S1..Sn。',
    '3) Quote 必须是对 source body 的逐字短摘录（1-3 句），用 Markdown blockquote（以 > 开头）输出，并在同一行末尾带 [S#]。',
    '',
    '结构要求（材料少可从简，但尽量保留骨架）：',
    '- ## 导读（How to read）',
    '- ## Executive Summary',
    '- ## 讨论全景（Coverage & Caveats）',
    '- ## 角色图谱（Role Atlas）',
    '- ## 关键张力（Key Tensions）',
    '- ## 主题地图（Themes, TalkToTheCity-style）',
    '- ## 未决问题与下一步议程（Agenda）',
    '- ## 方法（Method, brief）',
    '',
    '“主题地图”格式：',
    '- 主题标题：### T1 ... / ### T2 ...',
    '- Claim 标题：#### C1 ... / #### C2 ...（每条 Claim 下给 1-3 条 Quotes）',
  ].join('\n');
}

function normalizeReportMeta(params: {
  topicTitle: string;
  sourceLabels: string[];
  meta: Record<string, unknown> | null;
}): Record<string, unknown> {
  const sourceLabelSet = new Set(params.sourceLabels);
  const fallbackLabels = params.sourceLabels.slice(0, 3);
  const fallbackStatements = [
    {
      id: 'B1',
      text: '在结论分歧较大时，先把关键术语、评价指标与可验证证据缺口对齐，再讨论立场与方案。',
      conditions: ['明确术语与指标', '列出证据缺口与反例'],
      sourceLabels: fallbackLabels,
    },
    {
      id: 'B2',
      text: '将分歧拆解为“事实不确定 / 价值冲突 / 约束不同”，有助于把争论转化为可推进的议程。',
      conditions: ['区分事实/价值/约束', '对每类分歧提出可验证问题'],
      sourceLabels: fallbackLabels,
    },
    {
      id: 'B3',
      text: '在缺乏决定性证据前，优先采用可逆的小规模试点，并明确退出机制与风险边界。',
      conditions: ['试点可回滚', '明确退出机制与边界条件'],
      sourceLabels: fallbackLabels,
    },
  ].filter((b) => b.sourceLabels.length);

  const meta = params.meta ?? {};
  const bridgesRaw = (meta as any).bridges;
  const shareRaw = (meta as any).share;

  const bridgesObj = isPlainObject(bridgesRaw) ? bridgesRaw : {};
  const shareObj = isPlainObject(shareRaw) ? shareRaw : {};

  const gallerySizeRaw = (bridgesObj as any).gallerySize;
  const gallerySize =
    typeof gallerySizeRaw === 'number' && Number.isFinite(gallerySizeRaw) ? Math.max(1, gallerySizeRaw) : 3;

  const statementsRaw = Array.isArray((bridgesObj as any).statements) ? ((bridgesObj as any).statements as unknown[]) : [];
  const statements: Array<{ id: string; text: string; conditions: string[]; sourceLabels: string[] }> = [];

  for (const item of statementsRaw) {
    const id = typeof (item as any)?.id === 'string' ? String((item as any).id).trim() : '';
    const text = typeof (item as any)?.text === 'string' ? String((item as any).text).trim() : '';
    if (!/^B\\d+$/.test(id) || !text) continue;

    const conditionsRaw = (item as any)?.conditions;
    const conditions = Array.isArray(conditionsRaw)
      ? conditionsRaw.filter((c: unknown) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())
      : [];

    const sourceLabelsRaw = (item as any)?.sourceLabels;
    const sourceLabels = Array.isArray(sourceLabelsRaw)
      ? sourceLabelsRaw
          .filter((s: unknown) => typeof s === 'string' && /^S\\d+$/.test(s) && sourceLabelSet.has(s))
          .map((s: string) => s)
      : [];

    statements.push({ id, text, conditions, sourceLabels });
  }

  const effectiveStatements = statements.length ? statements : fallbackStatements;

  const galleryIdsRaw = Array.isArray((bridgesObj as any).galleryIds) ? ((bridgesObj as any).galleryIds as unknown[]) : [];
  const galleryIds = galleryIdsRaw.filter((id: unknown) => typeof id === 'string' && /^B\\d+$/.test(id as string)) as string[];
  const effectiveGalleryIds = galleryIds.filter((id) => effectiveStatements.some((s) => s.id === id));
  const fallbackGalleryIds = effectiveStatements.slice(0, gallerySize).map((s) => s.id);

  const featuredBridgeIdsRaw = Array.isArray((shareObj as any).featuredBridgeIds)
    ? ((shareObj as any).featuredBridgeIds as unknown[])
    : [];
  const featuredBridgeIds = featuredBridgeIdsRaw.filter((id: unknown) => typeof id === 'string' && /^B\\d+$/.test(id as string)) as string[];
  const effectiveFeaturedIds = featuredBridgeIds.filter((id) => effectiveStatements.some((s) => s.id === id));

  const defaultOgTitle = `${params.topicTitle} · 共识报告`;
  const ogTitle =
    typeof (shareObj as any).ogTitle === 'string' && String((shareObj as any).ogTitle).trim()
      ? String((shareObj as any).ogTitle).trim()
      : defaultOgTitle;
  const ogDescription =
    typeof (shareObj as any).ogDescription === 'string' && String((shareObj as any).ogDescription).trim()
      ? String((shareObj as any).ogDescription).trim()
      : '基于讨论内容生成的共识桥梁与分歧结构摘要。';
  const shareText =
    typeof (shareObj as any).shareText === 'string' && String((shareObj as any).shareText).trim()
      ? String((shareObj as any).shareText).trim()
      : `【共识报告】${params.topicTitle}\n\n${effectiveStatements[0]?.text ?? ''}`.trim();

  return {
    ...meta,
    bridges: {
      gallerySize,
      galleryIds: effectiveGalleryIds.length ? effectiveGalleryIds.slice(0, gallerySize) : fallbackGalleryIds,
      statements: effectiveStatements,
    },
    share: {
      featuredBridgeIds: effectiveFeaturedIds.length
        ? effectiveFeaturedIds.slice(0, 7)
        : fallbackGalleryIds.slice(0, Math.min(3, fallbackGalleryIds.length)),
      ogTitle,
      ogDescription,
      shareText,
    },
  };
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
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'openrouter';

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
      const sourceLabels = input.sources.map((s) => s.label);
      const extraHeaders: Record<string, string> = {
        ...(openRouterHttpReferer ? { 'HTTP-Referer': openRouterHttpReferer } : {}),
        ...(openRouterTitle ? { 'X-Title': openRouterTitle } : {}),
      };

      if (!apiKey) {
        console.warn('[consensus-report] OPENROUTER_API_KEY missing; returning fallback report.');
        return {
          contentMd: buildFallbackConsensusReport(input, { reason: 'OPENROUTER_API_KEY missing' }),
          model: 'fallback-report',
        };
      }

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

      try {
        if (input.params.promptVersion === CHAINED_PROMPT_VERSION) {
          const metaSystemPrompt = buildChainedMetaSystemPrompt();
          const metaUserPrompt = [
            `Topic: ${input.topicTitle}`,
            '',
            `Coverage: argumentsIncluded=${input.coverage.argumentsIncluded}/${input.coverage.argumentsTotal}, votesIncluded=${input.coverage.votesIncluded}/${input.coverage.votesTotal}`,
            `Selection: strategy=${input.params.selection.strategy}, maxSources=${input.params.selection.maxSources}, maxCharsPerSource=${input.params.selection.maxCharsPerSource}, topVotesK=${input.params.selection.topVotesK}, minPerBucket=${input.params.selection.minPerBucket}`,
            '',
            `Allowed sourceLabels: ${sourceLabels.join(', ')}`,
            '',
            'Sources:',
            sourcesBlock || '(no sources)',
            '',
            '请输出严格 JSON（不要 Markdown/代码围栏）。',
          ].join('\n');

          const metaAttempts = parsePositiveInt(process.env.REPORT_META_MAX_ATTEMPTS, 2);
          let metaObj: Record<string, unknown> | null = null;
          let lastMetaError: string | null = null;
          let usedModel: string | null = null;

          for (let attempt = 1; attempt <= metaAttempts; attempt += 1) {
            console.log(`[consensus-report] OpenRouter meta attempt ${attempt}/${metaAttempts} model=${model}`);

            const { contentMd, usedModel: m } = await callOpenRouterChatCompletion({
              baseUrl,
              apiKey,
              model,
              temperature,
              maxTokens,
              timeoutMs,
              messages: [
                { role: 'system', content: metaSystemPrompt },
                { role: 'user', content: metaUserPrompt },
                ...(lastMetaError
                  ? [
                      {
                        role: 'user' as const,
                        content: `你上一版 JSON 不可解析或不符合结构要求（${lastMetaError}）。请只输出严格 JSON（不要代码围栏/注释/尾逗号）。`,
                      },
                    ]
                  : []),
              ],
              extraHeaders,
            });

            usedModel = m;
            const parsed = parseJsonObjectFromText(contentMd);
            if (parsed && looksLikeReportMeta(parsed)) {
              metaObj = parsed;
              break;
            }

            lastMetaError = parsed ? '缺少 bridges/share 字段' : 'JSON.parse failed';
          }

          const normalizedMeta = normalizeReportMeta({
            topicTitle: input.topicTitle,
            sourceLabels,
            meta: metaObj,
          });

          const bodySystemPrompt = buildChainedBodySystemPrompt();
          const bodyUserPrompt = [
            `Topic: ${input.topicTitle}`,
            '',
            `Coverage: argumentsIncluded=${input.coverage.argumentsIncluded}/${input.coverage.argumentsTotal}, votesIncluded=${input.coverage.votesIncluded}/${input.coverage.votesTotal}`,
            '',
            'REPORT_META JSON（仅供参考，不要在输出中重复 JSON/不要输出 meta markers）：',
            '```json',
            JSON.stringify(normalizedMeta, null, 2),
            '```',
            '',
            'Sources:',
            sourcesBlock || '(no sources)',
            '',
            '请输出：报告正文（Markdown）。不要输出 REPORT_META。',
          ].join('\n');

          console.log(`[consensus-report] OpenRouter body attempt 1/1 model=${model}`);
          const { contentMd: rawBody, usedModel: bodyUsedModel } = await callOpenRouterChatCompletion({
            baseUrl,
            apiKey,
            model,
            temperature,
            maxTokens,
            timeoutMs,
            messages: [
              { role: 'system', content: bodySystemPrompt },
              { role: 'user', content: bodyUserPrompt },
            ],
            extraHeaders,
          });

          const cleanedBody = unwrapMarkdownFence(extractReportMetaAndBody(rawBody).body);
          const metaBlock = [REPORT_META_START, '```json', JSON.stringify(normalizedMeta, null, 2), '```', REPORT_META_END].join('\n');
          const contentMd = [metaBlock, cleanedBody.trim()].filter(Boolean).join('\n\n');

          const validation = validateLongformReport({ contentMd, sourceLabels, sourceCount: input.sources.length });
          if (validation.ok) {
            if (validation.warnings.length) {
              console.warn(`[consensus-report] Quality warnings accepted: ${validation.warnings.join(' | ')}`);
            }
            return { contentMd, model: bodyUsedModel ?? usedModel ?? model };
          }

          console.warn('[consensus-report] Chained report failed minimal checks; returning fallback report.');
          return {
            contentMd: buildFallbackConsensusReport(input, { reason: validation.reasons.join(' | ') }),
            model: bodyUsedModel ?? usedModel ?? model,
          };
        }

        const systemPrompt = buildSystemPrompt(input.params.promptVersion);
        const userPrompt = [
          `Topic: ${input.topicTitle}`,
          '',
          `Coverage: argumentsIncluded=${input.coverage.argumentsIncluded}/${input.coverage.argumentsTotal}, votesIncluded=${input.coverage.votesIncluded}/${input.coverage.votesTotal}`,
          `Selection: strategy=${input.params.selection.strategy}, maxSources=${input.params.selection.maxSources}, maxCharsPerSource=${input.params.selection.maxCharsPerSource}, topVotesK=${input.params.selection.topVotesK}, minPerBucket=${input.params.selection.minPerBucket}`,
          '',
          'Sources:',
          sourcesBlock || '(no sources)',
          '',
          '请按 system prompt 的格式输出：先 REPORT_META 的 JSON 元数据块，再输出 Markdown 报告正文。再次强调：尽量在关键观点句末附 [S#] 引用。',
        ].join('\n');

        const attempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : 2;

        let lastValidationError: Error | null = null;
        let feedback: string | null = null;
        let lastUsedModel: string | null = null;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const messages: Array<{ role: 'system' | 'user'; content: string }> = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ];
          if (feedback) messages.push({ role: 'user', content: feedback });

          console.log(
            `[consensus-report] OpenRouter generate attempt ${attempt}/${attempts} model=${model} sources=${input.sources.length}`,
          );

          const { contentMd, usedModel } = await callOpenRouterChatCompletion({
            baseUrl,
            apiKey,
            model,
            temperature,
            maxTokens,
            timeoutMs,
            messages,
            extraHeaders,
          });

          lastUsedModel = usedModel;

          const extracted = extractReportMetaAndBody(contentMd);
          const normalizedMeta = normalizeReportMeta({ topicTitle: input.topicTitle, sourceLabels, meta: extracted.meta });
          const normalizedContentMd = [
            REPORT_META_START,
            '```json',
            JSON.stringify(normalizedMeta, null, 2),
            '```',
            REPORT_META_END,
            '',
            unwrapMarkdownFence(extracted.body.trim()),
          ].join('\n');

          const validation = validateLongformReport({
            contentMd: normalizedContentMd,
            sourceLabels,
            sourceCount: input.sources.length,
          });

          if (validation.ok) {
            if (validation.warnings.length) {
              console.warn(`[consensus-report] Quality warnings accepted: ${validation.warnings.join(' | ')}`);
            }
            return { contentMd: normalizedContentMd, model: usedModel };
          }

          lastValidationError = new Error(`Consensus report failed minimal format checks: ${validation.reasons.join(' | ')}`);
          feedback = [
            '你上一版输出未通过最小格式要求，请完全重写并严格遵守 system prompt 的格式。失败原因：',
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
            '请确保输出包含 REPORT_META（严格 JSON）与非空正文；并尽量在关键观点句末使用 [S#] 引用。',
          ].join('\n');
        }

        console.warn(
          `[consensus-report] Falling back to minimal report after ${attempts} attempts: ${lastValidationError?.message ?? 'unknown error'}`,
        );

        return {
          contentMd: buildFallbackConsensusReport(input, { reason: lastValidationError?.message ?? 'unknown error' }),
          model: lastUsedModel ?? model,
        };
      } catch (err) {
        const reason = formatErrorWithCause(err);
        console.warn(`[consensus-report] OpenRouter generate failed; returning fallback report: ${reason}`);
        return { contentMd: buildFallbackConsensusReport(input, { reason }), model };
      }
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

function unwrapMarkdownFence(contentMd: string): string {
  const trimmed = contentMd.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (!match) return trimmed;
  const inner = match[1] ?? '';
  return inner.trim();
}

function validateLongformReport(params: {
  contentMd: string;
  sourceLabels: string[];
  sourceCount: number;
}): { ok: true; warnings: string[] } | { ok: false; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const extracted = extractReportMetaAndBody(params.contentMd);
  const meta = extracted.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    warnings.push('缺少或无法解析 REPORT_META JSON 元数据块');
  } else {
    const bridges = (meta as any).bridges;
    const statements = bridges?.statements;
    if (!Array.isArray(statements)) {
      warnings.push('REPORT_META.bridges.statements 缺失或格式错误');
    } else {
      const count = statements.length;
      if (count < 3) warnings.push(`Bridge Statements 数量偏少（${count}/3）`);
      if (count > 12) warnings.push(`Bridge Statements 数量偏多（${count}/12）`);
    }
  }

  const body = unwrapMarkdownFence(extracted.body);
  if (!body) reasons.push('报告正文为空');

  // Basic length gate (adaptive to material volume).
  const minChars =
    params.sourceCount >= 40 ? 7000 : params.sourceCount >= 24 ? 5500 : params.sourceCount >= 12 ? 3500 : 1800;
  if (body && body.length < minChars) warnings.push(`正文偏短（${body.length}/${minChars} chars）`);

  // Required sections (soft-ish but helps avoid barebones output).
  const requiredHeadings = ['## 导读', '## Executive Summary', '## 角色图谱', '## 关键张力', '## 主题地图', '## 未决问题', '## 方法'];
  for (const h of requiredHeadings) {
    if (body && !body.includes(h)) warnings.push(`缺少章节：${h}`);
  }

  const themeMatches = body ? [...body.matchAll(/^###\s+T\d+\b.*$/gm)] : [];
  const minThemes = params.sourceCount >= 24 ? 4 : params.sourceCount >= 12 ? 3 : 2;
  if (body && themeMatches.length < minThemes) warnings.push(`主题数量偏少（${themeMatches.length}/${minThemes}）`);

  const claimMatches = body ? [...body.matchAll(/^####\s+C\d+\b.*$/gm)] : [];
  const minClaimsPerTheme = params.sourceCount >= 24 ? 2 : params.sourceCount >= 12 ? 2 : 1;
  const minClaimsTotal = minThemes * minClaimsPerTheme;
  if (body && claimMatches.length < minClaimsTotal) warnings.push(`Claim 数量偏少（${claimMatches.length}/${minClaimsTotal}）`);

  const quoteLines = body ? [...body.matchAll(/^>\s+.*$/gm)] : [];
  const quotesPerClaim = 1;
  const minQuotesTotal = Math.max(0, claimMatches.length * quotesPerClaim);
  if (body && quoteLines.length < minQuotesTotal) warnings.push(`Quote 数量偏少（${quoteLines.length}/${minQuotesTotal}）`);

  const citations = body
    ? [...body.matchAll(/\[(S\d+)\]/g)].map((m) => m[1] ?? null).filter((v): v is string => Boolean(v))
    : [];
  const citationSet = new Set(params.sourceLabels);
  const invalid = citations.filter((label) => !citationSet.has(label));
  if (body && citations.length < Math.max(6, claimMatches.length)) warnings.push(`引用密度偏低（citations=${citations.length}）`);
  if (invalid.length > 0) {
    const unique = Array.from(new Set(invalid)).slice(0, 5);
    warnings.push(`包含无效引用标签：${unique.join(', ')}`);
  }

  if (reasons.length) return { ok: false, reasons, warnings };
  return { ok: true, warnings };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider type: ${String(value)}`);
}
