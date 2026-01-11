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
      const bulletLines = input.sources
        .slice(0, 10)
        .map((source) => {
          const title = source.title?.trim() ? ` — ${source.title.trim()}` : '';
          const excerpt = source.body.trim().slice(0, 160).replaceAll('\n', ' ');
          return `- (${source.totalVotes} votes)${title}: ${excerpt}${source.body.length > 160 ? '…' : ''} [${source.label}]`;
        })
        .join('\n');

      const contentMd = [
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
        '请基于用户提供的 Sources 列表，输出一份“非常详细”的中文 Markdown 共识报告。',
        '',
        '硬性要求：',
        '1) 只能基于 Sources 的内容，不要编造事实。',
        '2) 报告中的每一个具体观点/事实/归纳结论，必须紧跟 1 个或多个引用，引用格式只能是 [S1]、[S2]…（可多引用）。',
        '3) 不要输出 Sources 列表/参考文献/脚注列表（系统会在产品侧把 [S#] 渲染成脚注）。',
        '4) 不要输出任何内部 ID、URL 或其它不存在的引用；引用只能来自给定的 source labels。',
        '',
        '输出格式建议：',
        '- 使用清晰的标题层级（# / ## / ###）',
        '- 先给 Executive summary，再分别写主要阵营/分歧点/共识点/可执行建议/未解决问题',
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
        '请输出共识报告（Markdown）。再次强调：每一个观点都要紧跟 [S#] 引用。',
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

