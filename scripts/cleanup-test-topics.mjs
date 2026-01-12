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
    sinceHours: 24,
    prefix: 'Test Topic ',
  };

  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--all') args.all = true;
    else if (raw.startsWith('--since-hours=')) args.sinceHours = Number(raw.split('=', 2)[1]);
    else if (raw.startsWith('--prefix=')) args.prefix = raw.split('=', 2)[1] ?? args.prefix;
    else if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.sinceHours) || args.sinceHours <= 0) args.sinceHours = 24;

  return args;
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/cleanup-test-topics.mjs [--apply] [--all] [--since-hours=24] [--prefix="Test Topic "]',
      '',
      'Default behavior is dry-run (prints how many would be affected).',
      '',
      'Examples:',
      '  node scripts/cleanup-test-topics.mjs',
      '  node scripts/cleanup-test-topics.mjs --apply',
      '  node scripts/cleanup-test-topics.mjs --apply --all',
    ].join('\n'),
  );
}

loadRootEnv();
const args = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  console.error('[cleanup-test-topics] DATABASE_URL is missing; check your .env');
  process.exit(1);
}

const { getPrisma } = await import('@epiphany/database');
const prisma = getPrisma();

const where = {
  title: { startsWith: args.prefix },
  ...(args.all
    ? {}
    : {
        createdAt: { gte: new Date(Date.now() - args.sinceHours * 60 * 60 * 1000) },
      }),
};

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
    console.log('[cleanup-test-topics] Dry-run only. Re-run with --apply to set visibility=private.');
  } else {
    const result = await prisma.topic.updateMany({
      where,
      data: { visibility: 'private' },
    });

    console.log(`[cleanup-test-topics] Updated topics: ${result.count}`);
  }
} finally {
  await prisma.$disconnect();
}
