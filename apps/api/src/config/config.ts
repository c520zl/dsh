import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';

export type NodeEnv = 'development' | 'test' | 'production';
export type MailDriver = 'log' | 'resend';
export type PushDriver = 'log' | 'expo';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  host: string;
  databaseUrl: string;
  databasePool: number;
  redisUrl: string;
  logLevel: string;
  trustProxy: boolean;

  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
  maxDevices: number;

  otpLength: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpEmailHourlyLimit: number;
  otpIpHourlyLimit: number;

  googleClientId: string | null;
  appleClientId: string | null;

  mailDriver: MailDriver;
  mailFrom: string;
  resendApiKey: string | null;

  pushDriver: PushDriver;
  pushEnabled: boolean;

  storageDir: string;
  publicBaseUrl: string;
  exportTtlHours: number;

  rateLimitPerMinute: number;
  syncRateLimitPerMinute: number;

  trashRetentionDays: number;
  changeLogRetentionDays: number;
  processedOpsRetentionDays: number;
  reminderRetentionDays: number;
  auditRetentionDays: number;

  reminderTickMs: number;
  exportTickMs: number;
  cleanupTickMs: number;

  auditIpSalt: string;
}

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('postgres://todo:todo@127.0.0.1:5432/todo_dev'),
  DATABASE_POOL: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  LOG_LEVEL: z.string().min(1).default('info'),
  TRUST_PROXY: booleanString.default(false),

  JWT_ISSUER: z.string().min(1).default('todo-api'),
  JWT_AUDIENCE: z.string().min(1).default('todo-app'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUTH_JWT_PRIVATE_KEY: z.string().optional(),
  AUTH_JWT_PUBLIC_KEY: z.string().optional(),
  MAX_DEVICES: z.coerce.number().int().min(1).max(100).default(10),

  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  OTP_EMAIL_HOURLY_LIMIT: z.coerce.number().int().min(1).default(10),
  OTP_IP_HOURLY_LIMIT: z.coerce.number().int().min(1).default(30),

  GOOGLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),

  MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  MAIL_FROM: z.string().min(1).default('Todo App <no-reply@todo-app.test>'),
  RESEND_API_KEY: z.string().optional(),

  PUSH_DRIVER: z.enum(['log', 'expo']).default('log'),
  PUSH_ENABLED: booleanString.default(false),

  STORAGE_DIR: z.string().min(1).default('./storage'),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  EXPORT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  SYNC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),

  TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  CHANGE_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  PROCESSED_OPS_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  REMINDER_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),

  REMINDER_TICK_MS: z.coerce.number().int().min(250).default(5000),
  EXPORT_TICK_MS: z.coerce.number().int().min(250).default(5000),
  CLEANUP_TICK_MS: z.coerce.number().int().min(60_000).default(3_600_000),

  AUDIT_IP_SALT: z.string().min(1).default('todo-app-local-salt'),
});

function decodeKey(value: string): string {
  if (value.includes('BEGIN ')) {
    return value.replace(/\\n/g, '\n');
  }
  return Buffer.from(value, 'base64').toString('utf8').replace(/\\n/g, '\n');
}

function createEphemeralKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env && cachedConfig) {
    return cachedConfig;
  }
  const parsed = envSchema.parse(env);

  let privateKeyPem = parsed.AUTH_JWT_PRIVATE_KEY ? decodeKey(parsed.AUTH_JWT_PRIVATE_KEY) : null;
  let publicKeyPem = parsed.AUTH_JWT_PUBLIC_KEY ? decodeKey(parsed.AUTH_JWT_PUBLIC_KEY) : null;

  if (!privateKeyPem || !publicKeyPem) {
    if (parsed.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_JWT_PRIVATE_KEY and AUTH_JWT_PUBLIC_KEY are required in production (base64-encoded Ed25519 PKCS#8/SPKI PEM).',
      );
    }
    const ephemeral = createEphemeralKeys();
    privateKeyPem ??= ephemeral.privateKeyPem;
    publicKeyPem ??= ephemeral.publicKeyPem;
    process.emitWarning(
      'AUTH_JWT_PRIVATE_KEY/AUTH_JWT_PUBLIC_KEY are not set; using an ephemeral Ed25519 key pair. Access tokens will be invalid after restart.',
    );
  }

  if (parsed.NODE_ENV === 'production') {
    if (env.DATABASE_URL === undefined) {
      throw new Error('DATABASE_URL is required in production.');
    }
    if (env.REDIS_URL === undefined) {
      throw new Error('REDIS_URL is required in production.');
    }
  }

  const config: AppConfig = {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    databasePool: parsed.DATABASE_POOL,
    redisUrl: parsed.REDIS_URL,
    logLevel: parsed.LOG_LEVEL,
    trustProxy: parsed.TRUST_PROXY,

    jwtIssuer: parsed.JWT_ISSUER,
    jwtAudience: parsed.JWT_AUDIENCE,
    accessTokenTtlSeconds: parsed.JWT_ACCESS_TTL_SECONDS,
    refreshTokenTtlDays: parsed.JWT_REFRESH_TTL_DAYS,
    jwtPrivateKeyPem: privateKeyPem,
    jwtPublicKeyPem: publicKeyPem,
    maxDevices: parsed.MAX_DEVICES,

    otpLength: parsed.OTP_LENGTH,
    otpTtlSeconds: parsed.OTP_TTL_SECONDS,
    otpMaxAttempts: parsed.OTP_MAX_ATTEMPTS,
    otpResendCooldownSeconds: parsed.OTP_RESEND_COOLDOWN_SECONDS,
    otpEmailHourlyLimit: parsed.OTP_EMAIL_HOURLY_LIMIT,
    otpIpHourlyLimit: parsed.OTP_IP_HOURLY_LIMIT,

    googleClientId: parsed.GOOGLE_CLIENT_ID ?? null,
    appleClientId: parsed.APPLE_CLIENT_ID ?? null,

    mailDriver: parsed.MAIL_DRIVER,
    mailFrom: parsed.MAIL_FROM,
    resendApiKey: parsed.RESEND_API_KEY ?? null,

    pushDriver: parsed.PUSH_DRIVER,
    pushEnabled: parsed.PUSH_ENABLED,

    storageDir: parsed.STORAGE_DIR,
    publicBaseUrl: parsed.PUBLIC_BASE_URL.replace(/\/$/, ''),
    exportTtlHours: parsed.EXPORT_TTL_HOURS,

    rateLimitPerMinute: parsed.RATE_LIMIT_PER_MINUTE,
    syncRateLimitPerMinute: parsed.SYNC_RATE_LIMIT_PER_MINUTE,

    trashRetentionDays: parsed.TRASH_RETENTION_DAYS,
    changeLogRetentionDays: parsed.CHANGE_LOG_RETENTION_DAYS,
    processedOpsRetentionDays: parsed.PROCESSED_OPS_RETENTION_DAYS,
    reminderRetentionDays: parsed.REMINDER_RETENTION_DAYS,
    auditRetentionDays: parsed.AUDIT_RETENTION_DAYS,

    reminderTickMs: parsed.REMINDER_TICK_MS,
    exportTickMs: parsed.EXPORT_TICK_MS,
    cleanupTickMs: parsed.CLEANUP_TICK_MS,

    auditIpSalt: parsed.AUDIT_IP_SALT,
  };
  if (env === process.env) {
    cachedConfig = config;
  }
  return config;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
