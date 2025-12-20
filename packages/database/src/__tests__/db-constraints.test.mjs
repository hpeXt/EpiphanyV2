import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';

import pg from 'pg';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..', '..');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');

function getRequiredDatabaseUrl() {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing env: set DATABASE_URL_TEST (recommended) or DATABASE_URL');
  }
  return url;
}

function getAdminDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

function withDatabaseName(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function prismaBinPath() {
  const binaryName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  return path.join(packageRoot, 'node_modules', '.bin', binaryName);
}

async function prisma(args, env = {}) {
  const result = await execFileAsync(prismaBinPath(), [...args, '--schema', schemaPath], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function createDatabase(adminUrl, databaseName) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(adminUrl, databaseName) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await client.end();
  }
}

function randomUuid() {
  return crypto.randomUUID();
}

function randomPubkey(byteValue) {
  return Buffer.alloc(32, byteValue);
}

async function expectPgError(promise, { code }) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'Expected query to fail, but it succeeded');
  if (code) assert.equal(caught.code, code);
}

let testDatabaseUrl;
let adminDatabaseUrl;
let testDatabaseName;
let db;

before(async () => {
  const baseDatabaseUrl = getRequiredDatabaseUrl();
  adminDatabaseUrl = getAdminDatabaseUrl(baseDatabaseUrl);

  testDatabaseName = `t_${crypto.randomUUID().replaceAll('-', '')}`;
  testDatabaseUrl = withDatabaseName(baseDatabaseUrl, testDatabaseName);

  await createDatabase(adminDatabaseUrl, testDatabaseName);

  await prisma(['validate'], { DATABASE_URL: testDatabaseUrl });

  // Migrations should work on an empty DB and be repeatable.
  await prisma(['migrate', 'deploy'], { DATABASE_URL: testDatabaseUrl });
  await prisma(['migrate', 'deploy'], { DATABASE_URL: testDatabaseUrl });

  db = new pg.Client({ connectionString: testDatabaseUrl });
  await db.connect();
});

after(async () => {
  if (db) await db.end();
  if (adminDatabaseUrl && testDatabaseName) {
    await dropDatabase(adminDatabaseUrl, testDatabaseName);
  }
});

test('db constraints block bad data (Step03 red list)', async () => {
  const topicA = randomUuid();
  const topicB = randomUuid();

  await db.query(`INSERT INTO topics (id, title) VALUES ($1, $2)`, [topicA, 'Topic A']);
  await db.query(`INSERT INTO topics (id, title) VALUES ($1, $2)`, [topicB, 'Topic B']);

  const rootA = randomUuid();
  await db.query(
    `INSERT INTO arguments (id, topic_id, parent_id, title, body, author_pubkey) VALUES ($1, $2, NULL, $3, $4, $5)`,
    [rootA, topicA, 'Root A', 'Root body', randomPubkey(1)],
  );

  // Each topic has only one root (parent_id IS NULL).
  await expectPgError(
    db.query(
      `INSERT INTO arguments (id, topic_id, parent_id, title, body, author_pubkey) VALUES ($1, $2, NULL, $3, $4, $5)`,
      [randomUuid(), topicA, 'Root A2', 'Root body', randomPubkey(2)],
    ),
    { code: '23505' },
  );

  // Parent-child must be within the same topic.
  const childA = randomUuid();
  await db.query(
    `INSERT INTO arguments (id, topic_id, parent_id, title, body, author_pubkey) VALUES ($1, $2, $3, NULL, $4, $5)`,
    [childA, topicA, rootA, 'Child body', randomPubkey(3)],
  );

  await expectPgError(
    db.query(
      `INSERT INTO arguments (id, topic_id, parent_id, title, body, author_pubkey) VALUES ($1, $2, $3, NULL, $4, $5)`,
      [randomUuid(), topicB, rootA, 'Cross-topic parent', randomPubkey(4)],
    ),
    { code: '23503' },
  );

  // ledgers unique key: (topic_id, pubkey) cannot repeat.
  const voterA = randomPubkey(11);
  await db.query(`INSERT INTO ledgers (topic_id, pubkey) VALUES ($1, $2)`, [topicA, voterA]);
  await expectPgError(
    db.query(`INSERT INTO ledgers (topic_id, pubkey) VALUES ($1, $2)`, [topicA, voterA]),
    { code: '23505' },
  );

  // stakes unique key: (topic_id, argument_id, voter_pubkey) cannot repeat.
  await db.query(
    `INSERT INTO stakes (topic_id, argument_id, voter_pubkey, votes, cost) VALUES ($1, $2, $3, $4, $5)`,
    [topicA, childA, voterA, 2, 4],
  );
  await expectPgError(
    db.query(
      `INSERT INTO stakes (topic_id, argument_id, voter_pubkey, votes, cost) VALUES ($1, $2, $3, $4, $5)`,
      [topicA, childA, voterA, 2, 4],
    ),
    { code: '23505' },
  );

  // Stake votes range + cost = votes^2.
  const voterB = randomPubkey(12);
  await db.query(`INSERT INTO ledgers (topic_id, pubkey) VALUES ($1, $2)`, [topicA, voterB]);

  await expectPgError(
    db.query(
      `INSERT INTO stakes (topic_id, argument_id, voter_pubkey, votes, cost) VALUES ($1, $2, $3, $4, $5)`,
      [topicA, childA, voterB, 0, 0],
    ),
    { code: '23514' },
  );

  await expectPgError(
    db.query(
      `INSERT INTO stakes (topic_id, argument_id, voter_pubkey, votes, cost) VALUES ($1, $2, $3, $4, $5)`,
      [topicA, childA, voterB, 11, 121],
    ),
    { code: '23514' },
  );

  await expectPgError(
    db.query(
      `INSERT INTO stakes (topic_id, argument_id, voter_pubkey, votes, cost) VALUES ($1, $2, $3, $4, $5)`,
      [topicA, childA, voterB, 3, 10],
    ),
    { code: '23514' },
  );

  // (Optional) pgvector: extension present + wrong embedding dimension should fail.
  const { rowCount } = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
  assert.equal(rowCount, 1);

  await expectPgError(
    db.query(`UPDATE arguments SET embedding = '[1,2,3]'::vector WHERE id = $1`, [childA]),
    {},
  );
});

