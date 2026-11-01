import { defineConfig } from 'drizzle-kit';
import { loadDotEnv } from './src/config/load-env';

loadDotEnv();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://todo:todo@127.0.0.1:5432/todo_dev',
  },
  // The canonical baseline lives in docs/sql/001_init.sql; drizzle-kit is used
  // only to propose future migrations from schema changes.
  strict: true,
  verbose: true,
});
