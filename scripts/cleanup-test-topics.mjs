import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
    const equalsIndex = withoutExport.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadRootEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  const parsed = parseEnvFile(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {
    apply: false,
    all: false,
    delete: false,
    sinceHours: 24,
    prefixes: [],
  };

  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--all') args.all = true;
    else if (raw === '--delete') args.delete = true;
    else if (raw.startsWith('--since-hours=')) args.sinceHours = Number(raw.split('=', 2)[1]);
    else if (raw.startsWith('--prefix=')) args.prefixes.push(raw.split('=', 2)[1] ?? '');
    else if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.sinceHours) || args.sinceHours <= 0) args.sinceHours = 24;
  if (!args.prefixes.length) args.prefixes = ['Test Topic '];

  return args;
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/cleanup-test-topics.mjs [--apply] [--delete] [--all] [--since-hours=24] [--prefix="Test Topic "] [--prefix="E2E::"]',
      '',
      'Default behavior is dry-run (prints how many would be affected).',
      '',
      'When --apply is set:',
      '- default: set matched topics visibility=private (hide from public list)',
      '- with --delete: delete matched topics and all related rows (destructive)',
      '',
      'Examples:',
      '  node scripts/cleanup-test-topics.mjs',
      '  node scripts/cleanup-test-topics.mjs --apply',
      '  node scripts/cleanup-test-topics.mjs --apply --all',
      '  node scripts/cleanup-test-topics.mjs --apply --delete --all',
      '  node scripts/cleanup-test-topics.mjs --apply --delete --all --prefix="Test Topic " --prefix="E2E::"',
    ].join('\n'),
  );
}

loadRootEnv();
const args = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  console.error('[cleanup-test-topics] DATABASE_URL is missing; check your .env');
  process.exit(1);
}

// Import from built workspace package path so this script works without adding root deps.
const { getPrisma } = await import('../packages/database/dist/index.js');
const prisma = getPrisma();

const where = buildWhere(args);

try {
  const count = await prisma.topic.count({ where });
  console.log(`[cleanup-test-topics] Matched topics: ${count}`);

  const sample = await prisma.topic.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, title: true, visibility: true, createdAt: true },
  });

  if (sample.length) {
    console.log('[cleanup-test-topics] Sample (up to 10):');
    for (const t of sample) {
      console.log(`- ${t.id} visibility=${t.visibility} createdAt=${t.createdAt.toISOString()} title=${t.title}`);
    }
  }

  if (!args.apply) {
    console.log(
      '[cleanup-test-topics] Dry-run only. Re-run with --apply to hide, or --apply --delete to remove.',
    );
  } else {
    if (!args.delete) {
      const result = await prisma.topic.updateMany({
        where,
        data: { visibility: 'private' },
      });

      console.log(`[cleanup-test-topics] Updated topics (visibility=private): ${result.count}`);
    } else {
      const topics = await prisma.topic.findMany({ where, select: { id: true } });
      const ids = topics.map((t) => t.id);

      console.log(`[cleanup-test-topics] Deleting topics: ${ids.length}`);
      if (!ids.length) {
        console.log('[cleanup-test-topics] Nothing to delete.');
      } else {
        // IMPORTANT: topic has a FK to root argument, so we must null rootArgumentId first,
        // then delete children (in correct order), then delete topics.
        const result = await prisma.$transaction([
          prisma.topic.updateMany({
            where: { id: { in: ids } },
            data: { rootArgumentId: null },
          }),
          prisma.stake.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.clusterData.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.camp.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.consensusReport.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.argument.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.ledger.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.topicIdentityProfile.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.topicPubkeyBlacklist.deleteMany({ where: { topicId: { in: ids } } }),
          prisma.topic.deleteMany({ where: { id: { in: ids } } }),
        ]);

        const deleted = result[result.length - 1];
        console.log(`[cleanup-test-topics] Deleted topics: ${deleted.count}`);
      }
    }
  }
} finally {
  await prisma.$disconnect();
}

function buildWhere(args) {
  const normalizedPrefixes = args.prefixes.map((p) => String(p ?? '')).filter((p) => p.trim().length > 0);
  const prefixes = normalizedPrefixes.length ? normalizedPrefixes : ['Test Topic '];

  return {
    OR: prefixes.map((prefix) => ({ title: { startsWith: prefix } })),
    ...(args.all
      ? {}
      : {
          createdAt: { gte: new Date(Date.now() - args.sinceHours * 60 * 60 * 1000) },
        }),
  };
}
