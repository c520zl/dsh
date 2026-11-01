import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RedisService } from '../../src/core/redis.service';
import { MAILER, type Mailer } from '../../src/modules/auth/mailer.service';
import {
  OAUTH_VERIFIER,
  type OAuthProfile,
  type OAuthProvider,
  type OAuthVerifier,
} from '../../src/modules/auth/oauth.service';

export class FakeMailer implements Mailer {
  readonly codes = new Map<string, string>();

  async sendOtp(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

export class FakeOAuth implements OAuthVerifier {
  async verify(provider: OAuthProvider, identityToken: string): Promise<OAuthProfile> {
    if (identityToken.startsWith('invalid')) {
      throw new Error('invalid token');
    }
    const clean = identityToken.replace(/[^a-zA-Z0-9]/g, '');
    return {
      provider,
      subject: `subject-${clean}`,
      email: `${clean.toLowerCase()}@oauth.test`,
      emailVerified: true,
    };
  }
}

export interface TestResponse {
  status: number;
  body: any;
  raw: string;
  headers: Record<string, unknown>;
}

export interface TestApp {
  app: NestFastifyApplication;
  mailer: FakeMailer;
  oauth: FakeOAuth;
  http: {
    request: (
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      path: string,
      options?: { body?: unknown; token?: string; headers?: Record<string, string> },
    ) => Promise<TestResponse>;
    get: (path: string, token?: string) => Promise<TestResponse>;
    post: (
      path: string,
      body?: unknown,
      token?: string,
      headers?: Record<string, string>,
    ) => Promise<TestResponse>;
    patch: (path: string, body?: unknown, token?: string) => Promise<TestResponse>;
    delete: (path: string, body?: unknown, token?: string) => Promise<TestResponse>;
  };
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const mailer = new FakeMailer();
  const oauth = new FakeOAuth();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(OAUTH_VERIFIER)
    .useValue(oauth)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ genReqId: () => `req_${randomUUID()}` }),
  );
  app.useLogger(process.env.DEBUG_TEST_LOGS === '1' ? ['error', 'warn'] : false);
  app.setGlobalPrefix('v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const request = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ): Promise<TestResponse> => {
    const url = path.startsWith('/v1') ? path : `/v1${path}`;
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers,
        payload: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    let body: unknown = null;
    if (response.body.length > 0) {
      try {
        body = JSON.parse(response.body);
      } catch {
        body = response.body;
      }
    }
    return {
      status: response.statusCode,
      body,
      raw: response.body,
      headers: response.headers as Record<string, unknown>,
    };
  };

  return {
    app,
    mailer,
    oauth,
    http: {
      request,
      get: (path, token) => request('GET', path, { token }),
      post: (path, body, token, headers) => request('POST', path, { body, token, headers }),
      patch: (path, body, token) => request('PATCH', path, { body, token }),
      delete: (path, body, token) => request('DELETE', path, { body, token }),
    },
    close: async () => {
      await app.close();
    },
  };
}

export interface TestUser {
  email: string;
  userId: string;
  deviceId: string;
  token: string;
  refreshToken: string;
  inboxId: string;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export async function registerUser(
  ctx: TestApp,
  options: { timezone?: string; deviceName?: string } = {},
): Promise<TestUser> {
  const email = uniqueEmail();
  const requested = await ctx.http.post('/auth/otp/request', { email });
  expect(requested.status).toBe(202);
  const code = ctx.mailer.codes.get(email);
  expect(code).toBeTruthy();
  const verified = await ctx.http.post('/auth/otp/verify', {
    email,
    code,
    device: {
      name: options.deviceName ?? 'Test iPhone',
      platform: 'ios',
      appVersion: '0.1.0',
      osVersion: '18.0',
    },
  });
  expect(verified.status).toBe(200);
  const user = {
    email,
    userId: verified.body.user.id,
    deviceId: verified.body.deviceId,
    token: verified.body.accessToken,
    refreshToken: verified.body.refreshToken,
    inboxId: '',
  };
  if (options.timezone) {
    const patched = await ctx.http.patch('/me', { timezone: options.timezone }, user.token);
    expect(patched.status).toBe(200);
  }
  const lists = await ctx.http.get('/lists', user.token);
  expect(lists.status).toBe(200);
  const inbox = (lists.body as Array<{ id: string; isDefault: boolean }>).find(
    (list) => list.isDefault,
  );
  expect(inbox).toBeTruthy();
  user.inboxId = inbox!.id;
  return user;
}

export async function clearOtpLimits(ctx: TestApp, email: string): Promise<void> {
  const redis = ctx.app.get(RedisService);
  await redis.client.del(
    `todo:otp:cooldown:${email.toLowerCase()}`,
    `todo:otp:hourly:email:${email.toLowerCase()}`,
  );
}

export async function loginDevice(
  ctx: TestApp,
  email: string,
  deviceName: string,
): Promise<{ token: string; refreshToken: string; deviceId: string }> {
  await clearOtpLimits(ctx, email);
  const requested = await ctx.http.post('/auth/otp/request', { email });
  expect(requested.status).toBe(202);
  const code = ctx.mailer.codes.get(email);
  expect(code).toBeTruthy();
  const verified = await ctx.http.post('/auth/otp/verify', {
    email,
    code,
    device: {
      name: deviceName,
      platform: 'ios',
      appVersion: '0.1.0',
      osVersion: '18.0',
    },
  });
  expect(verified.status).toBe(200);
  return {
    token: verified.body.accessToken,
    refreshToken: verified.body.refreshToken,
    deviceId: verified.body.deviceId,
  };
}

export async function createTask(
  ctx: TestApp,
  user: TestUser,
  body: Record<string, unknown> = {},
): Promise<any> {
  const response = await ctx.http.post('/tasks', { title: 'Test task', ...body }, user.token);
  expect(response.status).toBe(201);
  return response.body;
}
