import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');

const binaryName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const prismaBin = path.join(packageRoot, 'node_modules', '.bin', binaryName);

const env = { ...process.env };
env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/postgres';

const result = spawnSync(prismaBin, ['generate', '--schema', schemaPath], {
  cwd: packageRoot,
  env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

