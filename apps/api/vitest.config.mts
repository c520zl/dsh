import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://todo:todo@127.0.0.1:5432/todo_test';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const TEST_PRIVATE_KEY = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString('base64');
const TEST_PUBLIC_KEY = publicKey.export({ format: 'pem', type: 'spki' }).toString('base64');

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    sequence: { concurrent: false },
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    restoreMocks: true,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      LOG_LEVEL: 'silent',
      AUTH_JWT_PRIVATE_KEY: TEST_PRIVATE_KEY,
      AUTH_JWT_PUBLIC_KEY: TEST_PUBLIC_KEY,
      RATE_LIMIT_PER_MINUTE: '100000',
      SYNC_RATE_LIMIT_PER_MINUTE: '100000',
      STORAGE_DIR: './test-storage',
      PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
      OTP_RESEND_COOLDOWN_SECONDS: '60',
      OTP_IP_HOURLY_LIMIT: '100000',
      PUSH_ENABLED: 'false',
      TRUST_PROXY: 'false',
    },
  },
});
