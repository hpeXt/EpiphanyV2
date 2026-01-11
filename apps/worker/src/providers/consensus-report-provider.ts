/**
 * @file consensus-report-provider.ts
 * @description Consensus report providers (mock + OpenRouter external LLM)
 */

import type {
  ConsensusReportProvider,
  GenerateConsensusReportInput,
} from '../processors/consensus-report.js';

type ConsensusReportProviderType = 'mock' | 'openrouter';

function getConsensusReportProviderType(): ConsensusReportProviderType {
  const explicit = process.env.REPORT_PROVIDER?.toLowerCase();
  if (explicit === 'openrouter' || explicit === 'real') return 'openrouter';

  const fallback = process.env.AI_PROVIDER?.toLowerCase();
  if (fallback === 'openrouter' || fallback === 'real') return 'openrouter';

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
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const model = process.env.REPORT_MODEL ?? 'deepseek/deepseek-chat-v3-0324';
  const timeoutMs = Number(process.env.REPORT_TIMEOUT_MS ?? '180000');
  const temperature = Number(process.env.REPORT_TEMPERATURE ?? '0.2');
  const maxTokens = Number(process.env.REPORT_MAX_TOKENS ?? '4096');

  return {
    async generate(input: GenerateConsensusReportInput) {
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for REPORT_PROVIDER=openrouter');
      }

      const systemPrompt = [
        '你是一名专业的“共识报告”分析师。',
        '请基于用户提供的 Sources 列表，输出一份“非常精彩”的中文 Markdown 共识报告（宏观与微观兼具，适合传播）。',
        '',
        '硬性要求：',
        '1) 只能基于 Sources 的内容，不要编造事实。',
        '2) 报告中的每一个具体观点/事实/归纳结论，必须紧跟 1 个或多个引用，引用格式只能是 [S1]、[S2]…（可多引用）。',
        '3) 不要输出 Sources 列表/参考文献/脚注列表（系统会在产品侧把 [S#] 渲染成脚注）。',
        '4) 不要输出任何内部 ID、URL 或其它不存在的引用；引用只能来自给定的 source labels。',
        '5) 必须在输出最开始包含一个可机器解析的 JSON 元数据块（用于 Bridge Statement 卡片传播）。',
        '',
        '元数据块格式（必须严格遵守）：',
        '- 第一行必须是：<!-- REPORT_META_START -->',
        '- 然后紧跟一个 ```json 代码块，内容是**严格 JSON**（不要加注释，不要加尾逗号）',
        '- 然后紧跟一行：<!-- REPORT_META_END -->',
        '',
        'JSON 结构要求：',
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
        '额外硬性约束（请严格遵守）：',
        '- bridges.statements 至少 7 条，最多 12 条',
        '- id 必须按 B1..B12 的格式（只允许 B + 数字）',
        '- 每条 sourceLabels 至少 3 个，且必须来自给定的 [S#] labels',
        '- JSON 里不要包含任何多余字段（尤其不要出现 source 原文内容）',
        '',
        'Bridge Statements 质量要求：',
        '- 优先输出“可签字句子”（避免空泛套话）；若是条件共识，conditions 必须写清楚且可操作',
        '- 每条 bridge 的 sourceLabels 至少 3 个，且尽量覆盖不同立场/层级的来源',
        '',
        '输出格式建议：',
        '- 使用清晰的标题层级（# / ## / ###）',
        '- 报告正文在元数据块之后输出',
        '- 报告开头先给 TL;DR（3-7 条要点）',
        '- 其次给 Bridge Gallery（至少列出 B1..B3 的正文与条件，并带引用）',
        '- 再写关键分歧轴（Key Tensions）、角色/阵营（Role Atlas）、主题拆解（Themes）、未决问题（Agenda）',
      ].join('\n');

      const sourcesBlock = input.sources
        .map((s) => {
          const title = s.title?.trim() ? s.title.trim() : '(no title)';
          return [
            `[${s.label}] votes=${s.totalVotes}`,
            `title: ${title}`,
            'body:',
            s.body.trim(),
          ].join('\n');
        })
        .join('\n\n---\n\n');

      const userPrompt = [
        `Topic: ${input.topicTitle}`,
        '',
        'Sources:',
        sourcesBlock || '(no sources)',
        '',
        '请按 system prompt 的格式输出：先 REPORT_META 的 JSON 元数据块，再输出 Markdown 报告正文。再次强调：每一个观点都要紧跟 [S#] 引用。',
      ].join('\n');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`OpenRouter request failed: ${response.status} ${text || response.statusText}`);
        }

        const json = (await response.json()) as any;
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('OpenRouter returned empty content');
        }

        const usedModel = typeof json?.model === 'string' ? json.model : model;
        return { contentMd: content, model: usedModel };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider type: ${String(value)}`);
}
