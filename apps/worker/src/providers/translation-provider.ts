/**
 * @file translation-provider.ts
 * @description Translation provider (mock + OpenRouter) for zh/en content.
 */

export type TranslationLocale = 'zh' | 'en';
export type TranslationResourceType =
  | 'topic_title'
  | 'argument'
  | 'consensus_report'
  | 'camp'
  | 'topic_profile_display_name';

export type TranslationTask =
  | { resourceType: 'topic_title'; source: { title: string } }
  | { resourceType: 'argument'; source: { title: string | null; body: string } }
  | { resourceType: 'consensus_report'; source: { contentMd: string } }
  | { resourceType: 'camp'; source: { label: string | null; summary: string | null } }
  | { resourceType: 'topic_profile_display_name'; source: { displayName: string } };

export interface TranslationProvider {
  provider: 'mock' | 'openrouter';
  translate(
    task: TranslationTask,
    targetLocale: TranslationLocale,
  ): Promise<{
    data: Record<string, unknown>;
    model: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  }>;
}

type TranslationProviderType = 'mock' | 'openrouter';

function getTranslationProviderType(): TranslationProviderType {
  const explicit = process.env.TRANSLATION_PROVIDER?.toLowerCase();
  if (explicit === 'openrouter' || explicit === 'real') return 'openrouter';
  if (explicit === 'mock') return 'mock';

  // Auto-enable real translation when OpenRouter is configured, even if
  // TRANSLATION_PROVIDER isn't explicitly set in `.env`.
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'openrouter';

  const fallback = process.env.AI_PROVIDER?.toLowerCase();
  if (fallback === 'openrouter' || fallback === 'real') return 'openrouter';

  return 'mock';
}

export function createTranslationProvider(): TranslationProvider {
  const providerType = getTranslationProviderType();
  console.log(`[worker] Using translation provider: ${providerType}`);

  switch (providerType) {
    case 'openrouter':
      return createOpenRouterTranslationProvider();
    case 'mock':
      return createMockTranslationProvider();
    default:
      return assertNever(providerType);
  }
}

function createMockTranslationProvider(): TranslationProvider {
  return {
    provider: 'mock',
    async translate(task, targetLocale) {
      switch (task.resourceType) {
        case 'topic_title':
          return { data: { title: `[${targetLocale}] ${task.source.title}`.trim() }, model: 'mock-translation' };
        case 'argument':
          return {
            data: {
              title: task.source.title ? `[${targetLocale}] ${task.source.title}` : null,
              body: `[${targetLocale}] ${task.source.body}`.trim(),
            },
            model: 'mock-translation',
          };
        case 'topic_profile_display_name':
          return {
            data: { displayName: `[${targetLocale}] ${task.source.displayName}`.trim() },
            model: 'mock-translation',
          };
        case 'consensus_report':
          return { data: { contentMd: `[${targetLocale}]\n\n${task.source.contentMd}`.trim() }, model: 'mock-translation' };
        case 'camp':
          return {
            data: {
              label: task.source.label ? `[${targetLocale}] ${task.source.label}` : null,
              summary: task.source.summary ? `[${targetLocale}] ${task.source.summary}` : null,
            },
            model: 'mock-translation',
          };
        default:
          return assertNever(task);
      }
    },
  };
}

function createOpenRouterTranslationProvider(): TranslationProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const model = process.env.TRANSLATION_MODEL ?? 'z-ai/glm-4.7';
  const timeoutMs = Number(process.env.TRANSLATION_TIMEOUT_MS ?? '90000');
  const temperature = Number(process.env.TRANSLATION_TEMPERATURE ?? '0.1');
  const maxTokens = Number(process.env.TRANSLATION_MAX_TOKENS ?? '4096');

  return {
    provider: 'openrouter',
    async translate(task, targetLocale) {
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for TRANSLATION_PROVIDER=openrouter');
      }

      const targetLabel = targetLocale === 'zh' ? '简体中文' : '英文';
      const schemaHint = translationSchemaHint(task.resourceType);

      const systemPrompt = [
        '你是一个严格的“翻译引擎”。',
        `把用户提供的内容翻译成${targetLabel}。`,
        '',
        '硬性要求：',
        '1) 只输出严格 JSON（不要 Markdown，不要解释，不要多余字段）。',
        '2) 不要增删事实；不要编造内容。',
        '3) 保留原始换行与 Markdown 结构（如标题、列表、代码块、链接）。',
        '4) 若文本包含 [S1] 这类引用标签，必须原样保留（不要翻译/改写/移动）。',
        `5) 输出 JSON schema: ${schemaHint}`,
      ].join('\n');

      const userPrompt = [
        'INPUT_JSON:',
        '```json',
        JSON.stringify(task.source),
        '```',
        '',
        '请输出 OUTPUT_JSON（严格 JSON）：',
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

        const parsed = parseJsonFromModel(content);
        validateTranslationData(task.resourceType, parsed);

        const usedModel = typeof json?.model === 'string' ? json.model : model;
        const usage = json?.usage && typeof json.usage === 'object' ? json.usage : undefined;
        const usageOut =
          usage && (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number')
            ? {
                promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
                completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
                totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
              }
            : undefined;

        return { data: parsed as Record<string, unknown>, model: usedModel, usage: usageOut };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function translationSchemaHint(resourceType: TranslationResourceType): string {
  switch (resourceType) {
    case 'topic_title':
      return '{"title": string}';
    case 'argument':
      return '{"title": string|null, "body": string}';
    case 'topic_profile_display_name':
      return '{"displayName": string}';
    case 'consensus_report':
      return '{"contentMd": string}';
    case 'camp':
      return '{"label": string|null, "summary": string|null}';
    default:
      return assertNever(resourceType);
  }
}

function parseJsonFromModel(content: string): unknown {
  const fenced = content.match(/```json\\s*([\\s\\S]*?)\\s*```/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

  try {
    return JSON.parse(content);
  } catch {
    // fallthrough
  }

  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sliced = content.slice(first, last + 1);
    return JSON.parse(sliced);
  }

  throw new Error('Failed to parse JSON from model output');
}

function validateTranslationData(resourceType: TranslationResourceType, parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model output JSON must be an object');
  }
  const obj = parsed as Record<string, unknown>;

  switch (resourceType) {
    case 'topic_title': {
      if (typeof obj.title !== 'string' || !obj.title.trim()) {
        throw new Error('Model output must include non-empty string field: title');
      }
      return;
    }
    case 'argument': {
      if (obj.title !== null && obj.title !== undefined && typeof obj.title !== 'string') {
        throw new Error('Model output field title must be string|null');
      }
      if (typeof obj.body !== 'string' || !obj.body.trim()) {
        throw new Error('Model output must include non-empty string field: body');
      }
      return;
    }
    case 'topic_profile_display_name': {
      if (typeof obj.displayName !== 'string' || !obj.displayName.trim()) {
        throw new Error('Model output must include non-empty string field: displayName');
      }
      return;
    }
    case 'consensus_report': {
      if (typeof obj.contentMd !== 'string' || !obj.contentMd.trim()) {
        throw new Error('Model output must include non-empty string field: contentMd');
      }
      return;
    }
    case 'camp': {
      if (obj.label !== null && obj.label !== undefined && typeof obj.label !== 'string') {
        throw new Error('Model output field label must be string|null');
      }
      if (obj.summary !== null && obj.summary !== undefined && typeof obj.summary !== 'string') {
        throw new Error('Model output field summary must be string|null');
      }
      return;
    }
    default:
      return assertNever(resourceType);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
