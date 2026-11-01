import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { loadDotEnv } from '../config/load-env';

const MIGRATION_NAME = '001_init';

async function main(): Promise<void> {
  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://todo:todo@127.0.0.1:5432/todo_dev';
  const migrationPath = findMigrationFile();
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

  try {
    await sql`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const applied = await sql<{ name: string }[]>`
      select name from public.schema_migrations where name = ${MIGRATION_NAME}
    `;
    if (applied.length > 0) {
      process.stdout.write(`Migration ${MIGRATION_NAME} already applied.\n`);
      return;
    }

    const baseline = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'identity' and table_name = 'users'
      ) as exists
    `;
    if (baseline[0]?.exists) {
      await sql`insert into public.schema_migrations (name) values (${MIGRATION_NAME})`;
      process.stdout.write(
        `Baseline tables already exist; recorded ${MIGRATION_NAME} without re-running it.\n`,
      );
      return;
    }

    process.stdout.write(`Applying ${migrationPath} …\n`);
    await sql.file(migrationPath);
    await sql`insert into public.schema_migrations (name) values (${MIGRATION_NAME})`;
    process.stdout.write('Migration applied.\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function findMigrationFile(): string {
  const candidates = [
    process.env.MIGRATION_FILE,
    join(process.cwd(), 'docs/sql/001_init.sql'),
    join(process.cwd(), '..', 'docs/sql/001_init.sql'),
    join(process.cwd(), '..', '..', 'docs/sql/001_init.sql'),
    join(__dirname, '..', '..', '..', 'docs/sql/001_init.sql'),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(
    `Cannot find docs/sql/001_init.sql (looked in ${candidates.join(', ')}); set MIGRATION_FILE.`,
  );
}

main().catch((error: unknown) => {
  console.error('Migration failed', error);
  process.exit(1);
});
