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

type OpenRouterUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };

function stanceLabel(stance: -1 | 0 | 1): 'oppose' | 'neutral' | 'support' {
  if (stance === -1) return 'oppose';
  if (stance === 1) return 'support';
  return 'neutral';
}

function buildFallbackConsensusReport(input: GenerateConsensusReportInput, opts?: { reason?: string }): string {
  const fallbackLabels = input.sources.slice(0, 3).map((s) => s.label);
  const sortedSources = [...input.sources].sort((a, b) => {
    if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
    return a.label.localeCompare(b.label);
  });

  const sourcesForSummary = sortedSources.slice(0, 10);

  const themeCount = sortedSources.length >= 6 ? 3 : sortedSources.length >= 3 ? 2 : 1;
  const sourcesForThemes = sortedSources.slice(0, Math.min(sortedSources.length, Math.max(themeCount * 4, 8)));
  const themeBuckets: Array<typeof sourcesForThemes> = Array.from({ length: themeCount }, () => []);
  for (const [index, source] of sourcesForThemes.entries()) {
    themeBuckets[index % themeCount]!.push(source);
  }

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

  const reasonLine = opts?.reason ? `降级原因：${opts.reason}` : null;
  const coverageLine =
    input.coverage.argumentsTotal > 0
      ? `覆盖：argumentsIncluded=${input.coverage.argumentsIncluded}/${input.coverage.argumentsTotal}，votesIncluded=${input.coverage.votesIncluded}/${input.coverage.votesTotal}`
      : null;

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

  const bulletLines = sourcesForSummary
    .map((source) => {
      const title = source.title?.trim() ? ` — ${source.title.trim()}` : '';
      const excerpt = toInlineExcerpt(source.body, 180);
      return `- (${source.totalVotes} votes)${title}: ${excerpt}${source.body.length > 180 ? '…' : ''} [${source.label}]`;
    })
    .join('\n');

  const metaBlock = [REPORT_META_START, '```json', JSON.stringify(reportMeta, null, 2), '```', REPORT_META_END].join('\n');

  const executiveSummaryLines = sourcesForSummary
    .slice(0, 6)
    .map((source) => {
      const title = source.title?.trim() ? source.title.trim() : '（未命名观点）';
      const excerpt = toInlineExcerpt(source.body, 120);
      return `- ${title}：${excerpt} [${source.label}]`;
    })
    .join('\n');

  let claimIndex = 1;
  const themeMd = themeBuckets
    .map((bucket, bucketIndex) => {
      const anchor = bucket[0];
      const themeName = anchor ? pickFallbackThemeName(anchor, bucketIndex) : `讨论焦点 ${bucketIndex + 1}`;
      const describedLabels = bucket.map((s) => s.label).join(', ');

      const claims = bucket.slice(0, Math.max(2, bucket.length)).map((source) => {
        const claimTitle = pickFallbackClaimTitle(source);
        const excerpt = toInlineExcerpt(source.body, 260);
        const quote = extractShortQuote(source.body, 160);
        const quoteLine = quote ? `> ${quote} [${source.label}]` : null;

        const lines = [
          `#### C${claimIndex} ${claimTitle}`,
          `${excerpt} [${source.label}]`,
          quoteLine,
          `边界/下一步：需要把该主张的适用条件、关键指标与可反驳证据补齐，才能支持更强结论。 [${source.label}]`,
        ].filter((v): v is string => Boolean(v));

        claimIndex += 1;
        return lines.join('\n');
      });

      return [
        `### T${bucketIndex + 1} ${themeName}`,
        `本主题主要由 ${describedLabels || '（无）'} 等材料构成，以下为从中抽取的原子主张（fallback 版本按来源近似拆解）。`,
        '',
        claims.join('\n\n'),
      ].join('\n');
    })
    .join('\n\n');

  const agendaLines = themeBuckets
    .map((bucket, index) => {
      const anchor = bucket[0];
      const themeName = anchor ? pickFallbackThemeName(anchor, index) : `讨论焦点 ${index + 1}`;
      const cite = anchor?.label ?? fallbackLabels[0] ?? null;
      return cite ? `- 关于“${themeName}”：需要明确争议点到底是事实、价值还是约束差异？ [${cite}]` : `- 关于“${themeName}”：需要明确争议点到底是事实、价值还是约束差异？`;
    })
    .join('\n');

  const body = [
    '## 导读（How to read）',
    reasonLine
      ? `本报告当前为降级输出（${reasonLine}）：提供输入摘要与最小结构提示，便于继续迭代生成更完整的长文版本。`
      : '本报告当前为降级输出：提供输入摘要与最小结构提示，便于继续迭代生成更完整的长文版本。',
    coverageLine ? `\n\n${coverageLine}` : null,
    '',
    '## Executive Summary',
    '',
    executiveSummaryLines || '- （无）',
    '',
    '## 输入摘要（Top sources）',
    '',
    bulletLines || '- (no sources)',
    '',
    '## 主题地图（Themes, TalkToTheCity-style）',
    '',
    themeMd || '（材料不足，无法生成主题地图）',
    '',
    '## 未决问题与下一步议程（Agenda）',
    '',
    agendaLines || '- （无）',
    '',
    '## 方法（Method, brief）',
    [
      '本报告为降级生成：未调用外部模型。',
      '生成逻辑：按 votes 简单排序后做轮转分桶，形成 1–3 个主题；每个主题内按来源拆分成若干原子 Claim，并从原文中截取首段作为短摘录（Quote）。',
      '局限：主题与 Claim 的命名/归类仅为启发式近似，不能替代真正的语义聚类与跨来源综合。',
    ].join('\n'),
  ]
    .filter((v): v is string => Boolean(v))
    .join('\n');

  return [metaBlock, body].join('\n\n');
}

function toInlineExcerpt(text: string, maxChars: number): string {
  const normalized = text.trim().replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd();
}

function extractShortQuote(text: string, maxChars: number): string | null {
  const normalized = toInlineExcerpt(text, Math.max(0, maxChars + 40));
  if (!normalized) return null;

  const hardCut = normalized.slice(0, Math.min(normalized.length, maxChars));
  const punct = ['。', '！', '？', '.', '!', '?', '；', ';', '…'];
  const lastPunctIndex = punct.map((p) => hardCut.lastIndexOf(p)).reduce((acc, v) => Math.max(acc, v), -1);

  const sliced = lastPunctIndex >= 24 ? hardCut.slice(0, lastPunctIndex + 1) : hardCut;
  const trimmed = sliced.trim();
  if (!trimmed) return null;
  return normalized.length > trimmed.length ? `${trimmed}…` : trimmed;
}

function pickFallbackThemeName(source: GenerateConsensusReportInput['sources'][number], index: number): string {
  const title = source.title?.trim();
  if (title) return title.length > 32 ? `${title.slice(0, 31).trimEnd()}…` : title;

  const excerpt = toInlineExcerpt(source.body, 18);
  if (excerpt) return `${excerpt.trim()}…`;

  return `讨论焦点 ${index + 1}`;
}

function pickFallbackClaimTitle(source: GenerateConsensusReportInput['sources'][number]): string {
  const title = source.title?.trim();
  if (title) return title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title;
  const excerpt = toInlineExcerpt(source.body, 32);
  return excerpt ? excerpt : `来自 ${source.label} 的主张`;
}

type ConsensusSource = GenerateConsensusReportInput['sources'][number];
type RoleBullet = { text: string; sourceLabels: string[] };
type RoleCard = {
  name: string;
  oneLiner: string | null;
  topClaims: RoleBullet[];
  topObjections: RoleBullet[];
  acceptabilityConditions: RoleBullet[];
  sourceLabels: string[];
};

const ROLE_TEMPLATES: Array<{ id: string; name: string; hint: string; keywords: string[] }> = [
  {
    id: 'evidence',
    name: '证据/澄清派',
    hint: '最关注：术语定义、证据链、反例与可验证指标',
    keywords: ['定义', '术语', '指标', '证据', '反例', '可验证', '验证', '如何', '为什么', '是否', '?', '？'],
  },
  {
    id: 'institutions',
    name: '制度/国家平台派',
    hint: '最关注：国家/制度作为平台与约束条件',
    keywords: ['政治', '国家', '政府', '制度', '政体', '平台', '特区', '护照', '签证', '寡头', '暴民', '僭主', '合作'],
  },
  {
    id: 'builders',
    name: '技术/产品实践派',
    hint: '最关注：技术路线、协议/产品落地与副作用',
    keywords: ['技术', 'DAO', '以太坊', '比特币', '加密', '协议', '应用', '社交媒体', 'IM', '数据', '开源', '闭源'],
  },
  {
    id: 'community',
    name: '社区运营/空间派',
    hint: '最关注：社区组织、线下空间与长期运营机制',
    keywords: ['社区', '活动', 'Pop-up', 'hackerhouse', '火人', 'Zuzalu', '4Seas', 'Edge City', '节点', '永久', '来访', '数字游民', '轮辐', '轮蝠'],
  },
  {
    id: 'skeptics',
    name: '批评/风险约束派',
    hint: '最关注：风险、外部性与不可逆后果',
    keywords: ['风险', '外部性', '问题', '担心', '低效', '混乱', '情绪化', '极端化', '破坏', '排除', '不能', '无法', '代价'],
  },
  {
    id: 'values',
    name: '愿景/价值派',
    hint: '最关注：愿景叙事、价值选择与人文边界',
    keywords: ['愿', '繁荣', '社会形态', '千种', '意义', '目标', '欲望', '人文', '文化', '自由'],
  },
];

function sortSourceLabels(labels: string[]): string[] {
  const unique = Array.from(new Set(labels.filter((v) => typeof v === 'string' && /^S\\d+$/.test(v))));
  return unique.sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10));
}

function formatInlineCitations(labels: string[]): string {
  const sorted = sortSourceLabels(labels);
  if (!sorted.length) return '';
  return ` ${sorted.map((l) => `[${l}]`).join('')}`;
}

function shortenInline(text: string, maxChars: number): string {
  const trimmed = text.trim();
  const excerpt = toInlineExcerpt(trimmed, maxChars);
  if (!excerpt) return '';
  return trimmed.length > excerpt.length ? `${excerpt}…` : excerpt;
}

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\\r/g, '\n');
  const raw = normalized.split(/[。！？!?；;\\n]+/g);
  return raw.map((s) => s.trim()).filter(Boolean);
}

function findSentenceWithKeywords(text: string, keywords: string[], maxChars: number): string | null {
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    if (!sentence) continue;
    for (const kw of keywords) {
      if (kw && sentence.includes(kw)) return shortenInline(sentence, maxChars);
    }
  }
  return null;
}

function keywordScore(haystack: string, keywords: string[]): number {
  const normalized = haystack.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (normalized.includes(kw.toLowerCase())) score += 1;
  }
  return score;
}

function normalizeRoleBullets(params: {
  raw: unknown;
  allowedSourceLabels: Set<string>;
  fallbackSourceLabels: string[];
  maxItems: number;
}): RoleBullet[] {
  const out: RoleBullet[] = [];
  if (!params.raw) return out;

  const fallback = params.fallbackSourceLabels.filter((s) => params.allowedSourceLabels.has(s));

  const push = (text: string, labels: string[]) => {
    const cleaned = text.trim().replaceAll('\n', ' ');
    if (!cleaned) return;
    const sanitized = sortSourceLabels(labels.filter((l) => params.allowedSourceLabels.has(l)));
    out.push({ text: cleaned, sourceLabels: sanitized.length ? sanitized : fallback });
  };

  if (Array.isArray(params.raw)) {
    for (const item of params.raw) {
      if (out.length >= params.maxItems) break;
      if (typeof item === 'string') {
        push(item, fallback);
        continue;
      }
      if (!isPlainObject(item)) continue;

      const text =
        typeof (item as any).text === 'string'
          ? String((item as any).text)
          : typeof (item as any).summary === 'string'
            ? String((item as any).summary)
            : '';
      const labelsRaw = (item as any).sourceLabels;
      const labels = Array.isArray(labelsRaw) ? labelsRaw.filter((l: unknown) => typeof l === 'string') : fallback;
      if (text) push(text, labels as string[]);
    }

    return out;
  }

  if (typeof params.raw === 'string') {
    push(params.raw, fallback);
  }

  return out;
}

function buildRoleCardsFromMeta(params: {
  meta: Record<string, unknown> | null;
  allowedSourceLabels: Set<string>;
  maxRoles: number;
}): RoleCard[] {
  const metaObj = params.meta;
  if (!metaObj || !isPlainObject(metaObj)) return [];

  const analysis = (metaObj as any).analysis;
  if (!isPlainObject(analysis)) return [];

  const rolesRaw = (analysis as any).roles;
  if (!Array.isArray(rolesRaw)) return [];

  const roleCards: RoleCard[] = [];

  for (const role of rolesRaw) {
    if (roleCards.length >= params.maxRoles) break;
    if (!isPlainObject(role)) continue;

    const nameRaw = (role as any).name;
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!name) continue;

    const sourceLabelsRaw = (role as any).sourceLabels;
    const roleSourceLabels = Array.isArray(sourceLabelsRaw)
      ? sortSourceLabels(sourceLabelsRaw.filter((l: unknown) => typeof l === 'string' && params.allowedSourceLabels.has(l as string)) as string[])
      : [];

    const oneLinerRaw = (role as any).brief ?? (role as any).oneLiner ?? (role as any).stance;
    const oneLiner = typeof oneLinerRaw === 'string' && oneLinerRaw.trim() ? oneLinerRaw.trim() : null;

    const topClaims = normalizeRoleBullets({
      raw: (role as any).topClaims ?? (role as any).claims,
      allowedSourceLabels: params.allowedSourceLabels,
      fallbackSourceLabels: roleSourceLabels,
      maxItems: 6,
    });

    const topObjections = normalizeRoleBullets({
      raw: (role as any).topObjections ?? (role as any).objections,
      allowedSourceLabels: params.allowedSourceLabels,
      fallbackSourceLabels: roleSourceLabels,
      maxItems: 4,
    });

    const acceptabilityConditions = normalizeRoleBullets({
      raw: (role as any).acceptabilityConditions ?? (role as any).conditions,
      allowedSourceLabels: params.allowedSourceLabels,
      fallbackSourceLabels: roleSourceLabels,
      maxItems: 4,
    });

    roleCards.push({
      name,
      oneLiner,
      topClaims,
      topObjections,
      acceptabilityConditions,
      sourceLabels: roleSourceLabels,
    });
  }

  return roleCards;
}

function buildRoleCardsHeuristic(params: { sources: ConsensusSource[]; maxRoles: number }): RoleCard[] {
  const allowed = new Set(params.sources.map((s) => s.label));
  const groups = new Map<string, { template: (typeof ROLE_TEMPLATES)[number] | null; sources: ConsensusSource[] }>();

  for (const source of params.sources) {
    const haystack = `${source.title ?? ''}\n${source.body ?? ''}`.trim();
    let best: (typeof ROLE_TEMPLATES)[number] | null = null;
    let bestScore = 0;

    for (const template of ROLE_TEMPLATES) {
      const score = keywordScore(haystack, template.keywords);
      if (score > bestScore) {
        bestScore = score;
        best = template;
      }
    }

    const bucketId = best && bestScore > 0 ? best.id : 'general';
    const current = groups.get(bucketId) ?? { template: bestScore > 0 ? best : null, sources: [] };
    current.sources.push(source);
    groups.set(bucketId, current);
  }

  const orderedGroups = Array.from(groups.values())
    .map((g) => {
      const sorted = [...g.sources].sort((a, b) => {
        if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
        return a.label.localeCompare(b.label);
      });
      return { template: g.template, sources: sorted };
    })
    .sort((a, b) => b.sources.length - a.sources.length);

  const selectedGroups = orderedGroups.slice(0, Math.max(1, params.maxRoles));
  const negativeKeywords = ROLE_TEMPLATES.find((t) => t.id === 'skeptics')?.keywords ?? ['问题', '担心', '风险', '反对', '低效', '混乱'];
  const conditionKeywords = ['需要', '应', '应该', '必须', '如果', '可以'];

  const roleCards: RoleCard[] = [];

  for (const [index, group] of selectedGroups.entries()) {
    const roleSources = group.sources;
    if (!roleSources.length) continue;

    const name = group.template?.name ?? `角色 ${index + 1}`;
    const roleSourceLabels = sortSourceLabels(roleSources.map((s) => s.label).filter((s) => allowed.has(s)));
    const anchor = roleSources[0];

    const anchorTitle = anchor.title?.trim();
    const oneLinerBase = group.template?.hint ?? '最关注：从材料中提炼的稳定关切';
    const oneLiner = anchorTitle ? `${oneLinerBase}（如：${shortenInline(anchorTitle, 36)}）` : oneLinerBase;

    const topClaims: RoleBullet[] = roleSources.slice(0, 6).map((s) => {
      const title = s.title?.trim();
      const excerpt = toInlineExcerpt(s.body, 120);
      const text = title ? `${shortenInline(title, 48)}：${excerpt}` : excerpt || `来自 ${s.label} 的观点`;
      return { text, sourceLabels: [s.label] };
    });

    const topObjections: RoleBullet[] = [];
    for (const s of roleSources) {
      if (topObjections.length >= 3) break;
      const sentence = findSentenceWithKeywords(s.body, negativeKeywords, 120);
      if (!sentence) continue;
      topObjections.push({ text: sentence, sourceLabels: [s.label] });
    }

    const acceptabilityConditions: RoleBullet[] = [];
    for (const s of roleSources) {
      if (acceptabilityConditions.length >= 3) break;
      const sentence = findSentenceWithKeywords(s.body, conditionKeywords, 120);
      if (!sentence) continue;
      acceptabilityConditions.push({ text: sentence, sourceLabels: [s.label] });
    }

    roleCards.push({
      name,
      oneLiner,
      topClaims,
      topObjections,
      acceptabilityConditions,
      sourceLabels: roleSourceLabels,
    });
  }

  return roleCards;
}

function buildRoleCards(params: { sources: ConsensusSource[]; meta: Record<string, unknown> | null; maxRoles: number }): RoleCard[] {
  const allowed = new Set(params.sources.map((s) => s.label));
  const fromMeta = buildRoleCardsFromMeta({ meta: params.meta, allowedSourceLabels: allowed, maxRoles: params.maxRoles });
  if (fromMeta.length) return fromMeta;
  return buildRoleCardsHeuristic({ sources: params.sources, maxRoles: params.maxRoles });
}

function renderRoleAtlasSection(roles: RoleCard[]): string {
  if (!roles.length) return ['## 角色图谱（Role Atlas）', '', '（材料不足，无法提炼角色图谱。）'].join('\n');

  const lines: string[] = ['## 角色图谱（Role Atlas）', ''];
  for (const [index, role] of roles.entries()) {
    lines.push(`### R${index + 1} ${role.name}`);
    if (role.oneLiner) lines.push(`- 一句话立场：${role.oneLiner}${formatInlineCitations(role.sourceLabels)}`);

    const claims = role.topClaims.slice(0, 5);
    if (claims.length) {
      lines.push('- 核心主张（Top claims）：');
      for (const claim of claims) lines.push(`  - ${claim.text}${formatInlineCitations(claim.sourceLabels)}`);
    }

    const objections = role.topObjections.slice(0, 3);
    if (objections.length) {
      lines.push('- 核心反对（Top objections）：');
      for (const objection of objections) lines.push(`  - ${objection.text}${formatInlineCitations(objection.sourceLabels)}`);
    }

    const conditions = role.acceptabilityConditions.slice(0, 3);
    if (conditions.length) {
      lines.push('- 可接受条件（Acceptability conditions）：');
      for (const condition of conditions) lines.push(`  - ${condition.text}${formatInlineCitations(condition.sourceLabels)}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderKeyTensionsSection(roles: RoleCard[], fallbackLabels: string[]): string {
  const cite = formatInlineCitations(fallbackLabels);

  if (roles.length < 2) {
    return [
      '## 关键张力（Key Tensions）',
      '',
      `- 事实不确定 vs 价值选择 vs 约束差异：需要先把分歧类型拆清，才能推进到可行动方案。${cite}`,
    ].join('\n');
  }

  const pairs: Array<[RoleCard, RoleCard]> = [];
  for (let i = 0; i < roles.length - 1 && pairs.length < 3; i += 1) {
    pairs.push([roles[i]!, roles[i + 1]!]);
  }

  const lines: string[] = ['## 关键张力（Key Tensions）', ''];
  for (const [a, b] of pairs) {
    const aClaim = a.topClaims[0];
    const bClaim = b.topClaims[0];
    const aText = aClaim ? `${aClaim.text}${formatInlineCitations(aClaim.sourceLabels)}` : `${a.name}${formatInlineCitations(a.sourceLabels)}`;
    const bText = bClaim ? `${bClaim.text}${formatInlineCitations(bClaim.sourceLabels)}` : `${b.name}${formatInlineCitations(b.sourceLabels)}`;
    lines.push(`- **${a.name} ↔ ${b.name}**：${aText} ⇄ ${bText}`);
  }

  return lines.join('\n');
}

function ensureRoleAtlasSection(params: {
  bodyMd: string;
  sources: ConsensusSource[];
  meta: Record<string, unknown> | null;
}): string {
  const body = params.bodyMd.trim();
  if (!body) return body;
  if (body.includes('## 角色图谱')) return body;

  const roleCards = buildRoleCards({ sources: params.sources, meta: params.meta, maxRoles: 6 });
  const roleAtlas = renderRoleAtlasSection(roleCards).trim();
  if (!roleAtlas) return body;

  const insertBeforePatterns = [/^##\\s+关键张力\\b/m, /^##\\s+主题地图\\b/m, /^##\\s+未决问题\\b/m, /^##\\s+方法\\b/m];
  for (const re of insertBeforePatterns) {
    const idx = body.search(re);
    if (idx >= 0) {
      const before = body.slice(0, idx).trimEnd();
      const after = body.slice(idx).trimStart();
      return [before, roleAtlas, after].filter(Boolean).join('\n\n');
    }
  }

  return [body, roleAtlas].filter(Boolean).join('\n\n');
}

function buildHeuristicConsensusReportBody(
  input: GenerateConsensusReportInput,
  opts: { mode: 'fallback' | 'mock'; reason?: string | null },
): string {
  const sortedSources = [...input.sources].sort((a, b) => {
    if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
    return a.label.localeCompare(b.label);
  });

  const sourcesForSummary = sortedSources.slice(0, 10);
  const fallbackLabels = sourcesForSummary.slice(0, 3).map((s) => s.label);

  const coverageLine =
    input.coverage.argumentsTotal > 0
      ? `argumentsIncluded=${input.coverage.argumentsIncluded}/${input.coverage.argumentsTotal}，votesIncluded=${input.coverage.votesIncluded}/${input.coverage.votesTotal}`
      : null;

  const bulletLines = sourcesForSummary
    .map((source) => {
      const title = source.title?.trim() ? ` — ${shortenInline(source.title.trim(), 40)}` : '';
      const excerpt = toInlineExcerpt(source.body, 180);
      return `- (${source.totalVotes} votes)${title}: ${excerpt}${source.body.length > 180 ? '…' : ''} [${source.label}]`;
    })
    .join('\n');

  const executiveSummaryLines = sourcesForSummary
    .slice(0, 6)
    .map((source) => {
      const title = source.title?.trim() ? source.title.trim() : '（未命名观点）';
      const excerpt = toInlineExcerpt(source.body, 120);
      return `- ${shortenInline(title, 48)}：${excerpt} [${source.label}]`;
    })
    .join('\n');

  const roleCards = buildRoleCards({ sources: sortedSources, meta: null, maxRoles: 6 });
  const roleAtlasSection = renderRoleAtlasSection(roleCards);
  const keyTensionsSection = renderKeyTensionsSection(roleCards, fallbackLabels);

  const themeCount = sortedSources.length >= 6 ? 3 : sortedSources.length >= 3 ? 2 : 1;
  const sourcesForThemes = sortedSources.slice(0, Math.min(sortedSources.length, Math.max(themeCount * 4, 8)));
  const themeBuckets: Array<typeof sourcesForThemes> = Array.from({ length: themeCount }, () => []);
  for (const [index, source] of sourcesForThemes.entries()) {
    themeBuckets[index % themeCount]!.push(source);
  }

  let claimIndex = 1;
  const themeMd = themeBuckets
    .map((bucket, bucketIndex) => {
      const anchor = bucket[0];
      const themeName = anchor ? pickFallbackThemeName(anchor, bucketIndex) : `讨论焦点 ${bucketIndex + 1}`;
      const describedLabels = bucket.map((s) => s.label).join(', ');

      const claims = bucket.slice(0, Math.max(2, bucket.length)).map((source) => {
        const claimTitle = pickFallbackClaimTitle(source);
        const excerpt = toInlineExcerpt(source.body, 260);
        const quote = extractShortQuote(source.body, 160);
        const quoteLine = quote ? `> ${quote} [${source.label}]` : null;

        const lines = [
          `#### C${claimIndex} ${claimTitle}`,
          `${excerpt} [${source.label}]`,
          quoteLine,
          `边界/下一步：需要把该主张的适用条件、关键指标与可反驳证据补齐，才能支持更强结论。 [${source.label}]`,
        ].filter((v): v is string => Boolean(v));

        claimIndex += 1;
        return lines.join('\n');
      });

      return [
        `### T${bucketIndex + 1} ${themeName}`,
        `本主题主要由 ${describedLabels || '（无）'} 等材料构成，以下为从中抽取的原子主张（启发式按来源近似拆解）。`,
        '',
        claims.join('\n\n'),
      ].join('\n');
    })
    .join('\n\n');

  const agendaLines = themeBuckets
    .map((bucket, index) => {
      const anchor = bucket[0];
      const themeName = anchor ? pickFallbackThemeName(anchor, index) : `讨论焦点 ${index + 1}`;
      const cite = anchor?.label ?? fallbackLabels[0] ?? null;
      return cite ? `- 关于“${themeName}”：需要明确争议点到底是事实不确定、价值冲突还是约束差异？ [${cite}]` : `- 关于“${themeName}”：需要明确争议点到底是事实不确定、价值冲突还是约束差异？`;
    })
    .join('\n');

  const intro =
    opts.mode === 'fallback'
      ? opts.reason
        ? `本报告为降级输出（原因：${opts.reason}）。仍提供完整阅读骨架，便于继续讨论与迭代。`
        : '本报告为降级输出：外部模型不可用时的最小可读版本（仍含主题/角色/张力骨架）。'
      : '本报告基于讨论材料给出结构化总结：用“角色—张力—主题—原子主张”的方式帮助读者快速进入讨论。';

  const methodLines =
    opts.mode === 'fallback'
      ? [
          '本报告为降级生成：未调用外部模型。',
          '生成逻辑：按 votes 简单排序后做轮转分桶形成 1–3 个主题；按关键词启发式归纳若干角色；再抽取每条来源的短摘录作为可追溯的 Claim 线索。',
          '局限：主题/角色划分是启发式近似，不能替代语义聚类与跨来源综合；建议在外部模型恢复后重生成完整版本。',
        ].join('\n')
      : [
          '本报告当前由启发式模块生成（未调用外部模型）。',
          '生成逻辑：按 votes 简单排序后做轮转分桶形成 1–3 个主题；按关键词启发式归纳若干角色；每条 Claim 直接链接回来源 [S#] 便于审计。',
        ].join('\n');

  const discussionLines = [
    '## 讨论全景（Coverage & Caveats）',
    '',
    coverageLine ? `- 覆盖：${coverageLine}` : `- 覆盖：sources=${input.sources.length}（未提供 arguments/votes 聚合信息）`,
    input.coverage.votesTotal === 0 ? '- 提示：votesTotal=0，无法用票数判断代表性强弱。' : null,
    '- 说明：本版本不输出 Sources 附录；页面脚注会把 [S#] 映射回原文节点。',
  ]
    .filter((v): v is string => Boolean(v))
    .join('\n');

  const sections = [
    `# ${input.topicTitle} · 共识报告`,
    '',
    '## 导读（How to read）',
    intro,
    '',
    '## Executive Summary',
    '',
    executiveSummaryLines || '- （无）',
    '',
    discussionLines,
    '',
    roleAtlasSection,
    '',
    keyTensionsSection,
    '',
    '## 输入摘要（Top sources）',
    '',
    bulletLines || '- (no sources)',
    '',
    '## 主题地图（Themes, TalkToTheCity-style）',
    '',
    themeMd || '（材料不足，无法生成主题地图）',
    '',
    '## 未决问题与下一步议程（Agenda）',
    '',
    agendaLines || '- （无）',
    '',
    '## 方法（Method, brief）',
    methodLines,
  ];

  return sections.filter((v) => typeof v === 'string').join('\n');
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
      '硬性事实与引用纪律（尽量遵守；材料不足时可从简，但不要编造）：',
      '1) 只能使用用户提供的 Sources（以及用户额外给出的 Coverage/Params 信息）；不要引入外部事实。',
      '2) 关键断言尽量在句末附 1 个或多个引用 [S#]；不要求每一句都带引用，但每个主题/关键 Claim 至少要有可追溯的引用支撑。',
      '3) 不要输出 Sources 列表/参考文献/脚注列表（产品会把 [S#] 渲染成脚注并链接回原文）。',
      '4) 不要输出任何内部 ID、URL 或不存在的引用；引用只能来自给定的 source labels（S1..Sn）。',
      '5) Quote 若出现，必须是对 source body 的“逐字短摘录”（1-3 句），用 Markdown blockquote（以 > 开头）输出，并在同一行末尾带 [S#]。',
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
      '- bridges.statements 建议 5–10 条；材料较少时允许输出 3–6 条（至少 3 条）',
      '- id 必须按 B1..B12 的格式（只允许 B + 数字）',
      '- 每条 sourceLabels 尽量 ≥ 2 个（材料不足可 1 个），且必须来自给定的 [S#] labels',
      '- bridge.text 必须是“可签字句子”，避免空泛套话；若是条件共识，conditions 必须具体且可操作/可验证',
      '',
      '报告正文必须在元数据块之后输出，并且必须包含以下章节（顺序可微调，但都要出现）：',
      '## 导读（How to read）',
      '## Executive Summary（建议 6–10 条；关键条目尽量带引用）',
      '## 讨论全景（Coverage & Caveats）— 可使用用户提供的 coverage 数字；本节可少量无引用',
      '## 角色图谱（Role Atlas）— 4–8 个角色，每个角色给：关切/价值框架、核心主张、核心反对、可接受条件（都要引用）',
      '## 关键张力（Key Tensions）— 2–5 条“分歧轴”，明确两端各自最强理由（都要引用）',
      '## 主题地图（Themes, TalkToTheCity-style）— 这是主体长文',
      '## 未决问题与下一步议程（Agenda）— 把分歧转成可继续推进的问题清单（都要引用）',
      '## 方法（Method, brief）— 只描述你如何从 sources 抽取主题/角色/主张；可少量无引用',
      '',
      '“主题地图”请按可解析的格式输出（材料少可从简，但尽量保留骨架）：',
      '- 每个主题用三级标题：### T1 主题名 / ### T2 ...（至少 2 个主题；建议 3–6 个；材料较少时 2–4 个）',
      '- 每个主题先写 1–3 段“主题长描述”（每段 2–5 句；关键句尽量带引用）',
      '- 然后列出该主题的原子 Claims：每条 Claim 用四级标题：#### C1 Claim 标题（每个主题至少 1–2 条；建议 2–4 条）',
      '- 每条 Claim 下：',
      '  1) 先写一段 Claim 解释（1–3 句），关键句尽量带引用 [S#]',
      '  2) Quotes：建议给 1–2 条逐字摘录，用 > 开头并带 [S#]（材料不足可省略）',
      '  3) 最后写“反例/反驳/边界条件”小段（至少 1 句），尽量带引用 [S#]',
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

export function getConsensusReportProviderDiagnostics(): {
  provider: ConsensusReportProviderType;
  promptVersion: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
} {
  const provider = getConsensusReportProviderType();
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (process.env.REPORT_MODEL ?? 'deepseek/deepseek-chat-v3-0324').trim();

  return {
    provider,
    promptVersion: process.env.REPORT_PROMPT_VERSION ?? 'consensus-report/v6-t3c-longform',
    model,
    baseUrl,
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    timeoutMs: Number(process.env.REPORT_TIMEOUT_MS ?? '900000'),
    temperature: Number(process.env.REPORT_TEMPERATURE ?? '0.2'),
    maxTokens: Number(process.env.REPORT_MAX_TOKENS ?? '50000'),
    maxAttempts: Number(process.env.REPORT_MAX_ATTEMPTS ?? '2'),
  };
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

  console.log(
    `[consensus-report] OpenRouter config baseUrl=${baseUrl} model=${model} timeoutMs=${timeoutMs} maxTokens=${maxTokens} maxAttempts=${maxAttempts}`,
  );

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
          let metaUsage: OpenRouterUsage | undefined;
          let metaRequestId: string | undefined;

          for (let attempt = 1; attempt <= metaAttempts; attempt += 1) {
            console.log(`[consensus-report] OpenRouter meta attempt ${attempt}/${metaAttempts} model=${model}`);

            const { contentMd, usedModel: m, usage, requestId } = await callOpenRouterChatCompletion({
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
            metaUsage = usage;
            metaRequestId = requestId;
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
          const {
            contentMd: rawBody,
            usedModel: bodyUsedModel,
            usage: bodyUsage,
            requestId: bodyRequestId,
          } = await callOpenRouterChatCompletion({
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
          const metaWithDiagnostics = {
            ...normalizedMeta,
            analysis: {
              ...(isPlainObject((normalizedMeta as any).analysis) ? ((normalizedMeta as any).analysis as Record<string, unknown>) : {}),
              generation: {
                provider: 'openrouter',
                promptVersion: input.params.promptVersion,
                baseUrl,
                modelRequested: model,
                modelUsedMeta: usedModel,
                modelUsedBody: bodyUsedModel,
                requestIdMeta: metaRequestId,
                requestIdBody: bodyRequestId,
                usageMeta: metaUsage,
                usageBody: bodyUsage,
              },
            },
          };

          const metaBlock = [
            REPORT_META_START,
            '```json',
            JSON.stringify(metaWithDiagnostics, null, 2),
            '```',
            REPORT_META_END,
          ].join('\n');
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

          const { contentMd, usedModel, usage, requestId } = await callOpenRouterChatCompletion({
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
          const metaWithDiagnostics = {
            ...normalizedMeta,
            analysis: {
              ...(isPlainObject((normalizedMeta as any).analysis) ? ((normalizedMeta as any).analysis as Record<string, unknown>) : {}),
              generation: {
                provider: 'openrouter',
                promptVersion: input.params.promptVersion,
                baseUrl,
                modelRequested: model,
                modelUsed: usedModel,
                requestId,
                usage,
                attempt,
                maxAttempts: attempts,
              },
            },
          };
          const normalizedContentMd = [
            REPORT_META_START,
            '```json',
            JSON.stringify(metaWithDiagnostics, null, 2),
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
}): Promise<{ contentMd: string; usedModel: string; usage?: OpenRouterUsage; requestId?: string }> {
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
      const requestId = typeof json?.id === 'string' ? json.id : undefined;
      const usageRaw = json?.usage && typeof json.usage === 'object' ? json.usage : undefined;
      const usage: OpenRouterUsage | undefined =
        usageRaw && (typeof usageRaw.prompt_tokens === 'number' || typeof usageRaw.completion_tokens === 'number')
          ? {
              promptTokens: typeof usageRaw.prompt_tokens === 'number' ? usageRaw.prompt_tokens : undefined,
              completionTokens: typeof usageRaw.completion_tokens === 'number' ? usageRaw.completion_tokens : undefined,
              totalTokens: typeof usageRaw.total_tokens === 'number' ? usageRaw.total_tokens : undefined,
            }
          : undefined;

      if (usage) {
        const promptTokens = typeof usage.promptTokens === 'number' ? usage.promptTokens : null;
        const completionTokens = typeof usage.completionTokens === 'number' ? usage.completionTokens : null;
        const totalTokens = typeof usage.totalTokens === 'number' ? usage.totalTokens : null;
        const parts = [
          promptTokens !== null ? `prompt=${promptTokens}` : null,
          completionTokens !== null ? `completion=${completionTokens}` : null,
          totalTokens !== null ? `total=${totalTokens}` : null,
        ].filter((v): v is string => typeof v === 'string');
        if (parts.length) console.log(`[consensus-report] OpenRouter usage model=${usedModel}: ${parts.join(' ')}`);
      }

      return { contentMd: content, usedModel, usage, requestId };
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
    params.sourceCount >= 40 ? 4500 : params.sourceCount >= 24 ? 3200 : params.sourceCount >= 12 ? 1800 : 1200;
  if (body && body.length < minChars) warnings.push(`正文偏短（${body.length}/${minChars} chars）`);

  // Required sections (soft-ish but helps avoid barebones output).
  const requiredHeadings = ['## 导读', '## Executive Summary', '## 主题地图', '## 方法'];
  for (const h of requiredHeadings) {
    if (body && !body.includes(h)) warnings.push(`缺少章节：${h}`);
  }

  const themeMatches = body ? [...body.matchAll(/^###\s+T\d+\b.*$/gm)] : [];
  const minThemes = params.sourceCount >= 24 ? 3 : params.sourceCount >= 12 ? 2 : 1;
  if (body && themeMatches.length < minThemes) warnings.push(`主题数量偏少（${themeMatches.length}/${minThemes}）`);

  const claimMatches = body ? [...body.matchAll(/^####\s+C\d+\b.*$/gm)] : [];
  const minClaimsPerTheme = params.sourceCount >= 24 ? 2 : 1;
  const minClaimsTotal = minThemes * minClaimsPerTheme;
  if (body && claimMatches.length < minClaimsTotal) warnings.push(`Claim 数量偏少（${claimMatches.length}/${minClaimsTotal}）`);

  const quoteLines = body ? [...body.matchAll(/^>\s+.*$/gm)] : [];
  const quotesPerClaim = 0;
  const minQuotesTotal = Math.max(0, claimMatches.length * quotesPerClaim);
  if (body && quoteLines.length < minQuotesTotal) warnings.push(`Quote 数量偏少（${quoteLines.length}/${minQuotesTotal}）`);

  const citations = body
    ? [...body.matchAll(/\[(S\d+)\]/g)].map((m) => m[1] ?? null).filter((v): v is string => Boolean(v))
    : [];
  const citationSet = new Set(params.sourceLabels);
  const invalid = citations.filter((label) => !citationSet.has(label));
  const minCitations = Math.max(2, Math.ceil(claimMatches.length * 0.5));
  if (body && citations.length < minCitations) warnings.push(`引用密度偏低（citations=${citations.length}/${minCitations}）`);
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
