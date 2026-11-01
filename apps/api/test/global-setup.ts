import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import IORedis from 'ioredis';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://todo:todo@127.0.0.1:5432/todo_test';
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';

export default async function setup(): Promise<void> {
  const databaseName = new URL(DATABASE_URL).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive test setup against database "${databaseName}" (must end with _test)`,
    );
  }

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql`drop schema if exists identity cascade`;
    await sql`drop schema if exists todo cascade`;
    await sql`drop schema if exists notify cascade`;
    await sql`drop schema if exists sync cascade`;
    await sql`drop schema if exists ops cascade`;
    await sql`drop table if exists public.schema_migrations`;
    const migration = findFile('docs/sql/001_init.sql');
    await sql.file(migration);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const redis = new IORedis(REDIS_URL, { lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}

function findFile(relative: string): string {
  const candidates = [
    join(process.cwd(), relative),
    join(process.cwd(), '..', relative),
    join(process.cwd(), '..', '..', relative),
  ];
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(`Cannot find ${relative}`);
}
