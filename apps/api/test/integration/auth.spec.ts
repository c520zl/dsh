import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearOtpLimits,
  createTestApp,
  loginDevice,
  registerUser,
  uniqueEmail,
  type TestApp,
} from '../helpers/test-app';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe('email OTP authentication', () => {
  it('sends a generic message and creates the user, inbox and settings', async () => {
    const email = uniqueEmail('otp');
    const requested = await ctx.http.post('/auth/otp/request', { email });
    expect(requested.status).toBe(202);
    expect(requested.body).toEqual({ message: '验证码已发送' });

    const code = ctx.mailer.codes.get(email) as string;
    const wrongCode = code === '000000' ? '000001' : '000000';
    const wrong = await ctx.http.post('/auth/otp/verify', {
      email,
      code: wrongCode,
      device: { name: 'iPhone', platform: 'ios' },
    });
    expect(wrong.status).toBe(401);

    const verified = await ctx.http.post('/auth/otp/verify', {
      email,
      code,
      device: { name: 'iPhone', platform: 'ios', appVersion: '0.1.0', osVersion: '18.0' },
    });
    expect(verified.status).toBe(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.refreshToken).toBeTruthy();
    expect(verified.body.expiresIn).toBe(900);
    expect(verified.body.user.email).toBe(email);

    const me = await ctx.http.get('/me', verified.body.accessToken);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.settings.defaultReminderTime).toBe('09:00');

    const lists = await ctx.http.get('/lists', verified.body.accessToken);
    expect(lists.status).toBe(200);
    const inbox = lists.body.find((list: { isDefault: boolean }) => list.isDefault);
    expect(inbox).toMatchObject({ name: '收件箱', isDefault: true });
    expect(me.body.settings.defaultListId).toBe(inbox.id);
  });

  it('validates input and enforces the resend cooldown', async () => {
    const invalid = await ctx.http.post('/auth/otp/request', {
      email: 'not-an-email',
      extra: true,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const email = uniqueEmail('cooldown');
    expect((await ctx.http.post('/auth/otp/request', { email })).status).toBe(202);
    const second = await ctx.http.post('/auth/otp/request', { email });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('protects endpoints and rejects invalid access tokens', async () => {
    expect((await ctx.http.get('/me')).status).toBe(401);
    const invalid = await ctx.http.get('/me', 'not-a-token');
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('UNAUTHENTICATED');
    expect(invalid.body.error.requestId).toMatch(/^req_/);
  });

  it('rotates refresh tokens and revokes the family on replay', async () => {
    const user = await registerUser(ctx);
    const refreshed = await ctx.http.post('/auth/refresh', {
      refreshToken: user.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(user.refreshToken);
    expect(refreshed.body.accessToken).toBeTruthy();

    const replay = await ctx.http.post('/auth/refresh', {
      refreshToken: user.refreshToken,
    });
    expect(replay.status).toBe(401);

    const newTokenAfterReplay = await ctx.http.post('/auth/refresh', {
      refreshToken: refreshed.body.refreshToken,
    });
    expect(newTokenAfterReplay.status).toBe(401);

    // Device auth version was bumped, so the access token issued by the rotation dies too.
    expect((await ctx.http.get('/me', refreshed.body.accessToken)).status).toBe(401);
  });

  it('logs out the current device immediately', async () => {
    const user = await registerUser(ctx);
    const logout = await ctx.http.post('/auth/logout', {}, user.token);
    expect(logout.status).toBe(204);
    expect((await ctx.http.get('/me', user.token)).status).toBe(401);
  });

  it('lists, renames and revokes devices', async () => {
    const user = await registerUser(ctx);
    const second = await loginDevice(ctx, user.email, 'Test iPad');
    expect(second.deviceId).not.toBe(user.deviceId);

    const devices = await ctx.http.get('/devices', user.token);
    expect(devices.status).toBe(200);
    expect(devices.body).toHaveLength(2);

    const renamed = await ctx.http.patch(
      `/devices/${second.deviceId}`,
      { name: 'Test iPad Pro', pushProvider: 'expo', pushToken: 'ExponentPushToken[abc]' },
      user.token,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Test iPad Pro');
    expect(renamed.body.pushProvider).toBe('expo');

    const revoked = await ctx.http.delete(`/devices/${second.deviceId}`, undefined, user.token);
    expect(revoked.status).toBe(204);
    expect((await ctx.http.get('/me', second.token)).status).toBe(401);
    const remaining = await ctx.http.get('/devices', user.token);
    expect(remaining.body).toHaveLength(1);
  });

  it('updates profile and settings and validates the timezone', async () => {
    const user = await registerUser(ctx);
    const invalid = await ctx.http.patch('/me', { timezone: 'Mars/Olympus' }, user.token);
    expect(invalid.status).toBe(400);

    const updated = await ctx.http.patch(
      '/me',
      {
        displayName: '牛奶爱好者',
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        settings: {
          theme: 'dark',
          accent: 'teal',
          defaultReminderTime: '08:30',
          quietHours: { start: '22:00', end: '07:00' },
          notificationPrefs: { reminders: true, digest: false },
        },
      },
      user.token,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.user.displayName).toBe('牛奶爱好者');
    expect(updated.body.user.timezone).toBe('Asia/Shanghai');
    expect(updated.body.settings.theme).toBe('dark');
    expect(updated.body.settings.defaultReminderTime).toBe('08:30');
    expect(updated.body.settings.quietHours).toEqual({ start: '22:00', end: '07:00' });
    expect(updated.body.settings.version).toBe(2);
  });

  it('logs in with a verified Apple/Google identity', async () => {
    const login = await ctx.http.post('/auth/oauth/google', {
      identityToken: 'google-alice-token-123456',
      device: { name: 'Pixel', platform: 'android' },
    });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('googlealicetoken123456@oauth.test');
    const me = await ctx.http.get('/me', login.body.accessToken);
    expect(me.status).toBe(200);

    const secondLogin = await ctx.http.post('/auth/oauth/google', {
      identityToken: 'google-alice-token-123456',
      device: { name: 'Pixel', platform: 'android' },
    });
    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.user.id).toBe(login.body.user.id);
  });

  it('schedules account deletion and blocks re-registration', async () => {
    const deletionEmail = uniqueEmail('delete');
    await clearOtpLimits(ctx, deletionEmail);
    await ctx.http.post('/auth/otp/request', { email: deletionEmail });
    const code = ctx.mailer.codes.get(deletionEmail);
    const verified = await ctx.http.post('/auth/otp/verify', {
      email: deletionEmail,
      code,
      device: { name: 'Deletion Phone', platform: 'ios' },
    });
    expect(verified.status).toBe(200);
    const token = verified.body.accessToken;

    const deleted = await ctx.http.delete('/me', undefined, token);
    expect(deleted.status).toBe(202);
    expect(deleted.body.status).toBe('deletion_scheduled');
    expect(new Date(deleted.body.deleteAfter).getTime()).toBeGreaterThan(Date.now());
    expect((await ctx.http.get('/me', token)).status).toBe(401);

    await clearOtpLimits(ctx, deletionEmail);
    await ctx.http.post('/auth/otp/request', { email: deletionEmail });
    const secondCode = ctx.mailer.codes.get(deletionEmail);
    const blocked = await ctx.http.post('/auth/otp/verify', {
      email: deletionEmail,
      code: secondCode,
      device: { name: 'New Phone', platform: 'ios' },
    });
    expect(blocked.status).toBe(401);
  });
});
