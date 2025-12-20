import fs from 'node:fs';
import path from 'node:path';

function findUp(filename: string, startDir: string): string | null {
  let current = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(current, filename);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

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

export function loadEnv(): void {
  const globalAny = globalThis as typeof globalThis & {
    __EPIPHANY_ENV_LOADED__?: boolean;
  };
  if (globalAny.__EPIPHANY_ENV_LOADED__) return;
  globalAny.__EPIPHANY_ENV_LOADED__ = true;

  const envPath =
    findUp('.env', process.cwd()) ?? findUp('.env', __dirname) ?? null;
  if (!envPath) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  const parsed = parseEnvFile(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

