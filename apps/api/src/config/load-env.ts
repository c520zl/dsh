import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Node 24 can read .env files natively. Tests set process.env explicitly and do
 * not want a developer's .env to leak into the test database, so they skip this.
 */
export function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  const envFile = resolve(process.cwd(), '.env');
  if (!existsSync(envFile)) {
    return;
  }
  process.loadEnvFile(envFile);
}
