import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { forbidden, rateLimited, unauthorized } from '../../common/errors';
import { toUserDto, type UserRow } from '../../common/user.mapper';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { addDays } from '../../domain/time';
import { newId } from '../../domain/ids';
import { authIdentities, devices, refreshTokens, users } from '../../db/schema';
import { AuditService } from '../../core/audit.service';
import { DatabaseService } from '../../core/database.service';
import { ProvisioningService } from '../../core/provisioning.service';
import { TokenService } from '../../core/token.service';
import {
  type AuthResponseDto,
  type DeviceInfoInput,
  type OAuthRequestInput,
  type OtpRequestInput,
  type OtpVerifyInput,
  type RefreshRequestInput,
} from './auth.dto';
import { MAILER, type Mailer } from './mailer.service';
import { OAUTH_VERIFIER, type OAuthVerifier } from './oauth.service';
import { OtpStore } from './otp.store';

type DeviceRow = typeof devices.$inferSelect;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(OtpStore) private readonly otp: OtpStore,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(OAUTH_VERIFIER) private readonly oauth: OAuthVerifier,
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async requestOtp(input: OtpRequestInput, ip: string): Promise<{ message: string }> {
    const cooldown = await this.otp.setCooldown(input.email);
    if (cooldown !== null) {
      throw rateLimited('验证码发送过于频繁，请稍后重试', cooldown);
    }

    try {
      await this.otp.hitHourly('email', input.email);
      await this.otp.hitHourly('ip', ip);
      const max = 10 ** this.config.otpLength;
      const code = randomInt(0, max).toString().padStart(this.config.otpLength, '0');
      await this.otp.issue(input.email, code);
      await this.mailer.sendOtp(input.email, code);
      await this.audit.record({ event: 'otp_requested', ip });
      return { message: '验证码已发送' };
    } catch (error) {
      await this.otp.clearCooldown(input.email);
      await this.otp.remove(input.email);
      throw error;
    }
  }

  async verifyOtp(input: OtpVerifyInput, ip: string): Promise<AuthResponseDto> {
    await this.otp.verify(input.email, input.code);

    let user = await this.findActiveUserByEmail(input.email);
    if (!user) {
      const deleted = await this.findDeletedUserByEmail(input.email);
      if (deleted) {
        throw unauthorized('登录失败');
      }
      const created = await this.provisioning.createUser({
        email: input.email,
        displayName: displayNameFromEmail(input.email),
      });
      user = await this.getUserOrThrow(created.userId);
    }

    const response = await this.establishSession(user, input.device);
    await this.audit.record({
      userId: user.id,
      event: 'login_otp',
      ip,
      metadata: { deviceId: response.deviceId },
    });
    return response;
  }

  async loginWithOAuth(
    provider: 'apple' | 'google',
    input: OAuthRequestInput,
    ip: string,
  ): Promise<AuthResponseDto> {
    const profile = await this.oauth.verify(provider, input.identityToken);
    if (profile.email && profile.emailVerified === false) {
      throw unauthorized('第三方邮箱未验证');
    }

    const identity = await this.findIdentity(provider, profile.subject);
    let user: UserRow | null = identity ? await this.findActiveUserById(identity.userId) : null;

    if (!user && profile.email) {
      user = await this.findActiveUserByEmail(profile.email);
      if (user) {
        await this.linkIdentity(user.id, provider, profile.subject).catch((error: unknown) => {
          if (!isUniqueViolation(error)) {
            throw error;
          }
        });
      } else if (await this.findDeletedUserByEmail(profile.email)) {
        throw unauthorized('登录失败');
      }
    }

    if (!user) {
      if (!profile.email) {
        throw unauthorized('无法获取第三方账号邮箱，请使用邮箱验证码登录');
      }
      try {
        const created = await this.provisioning.createUser({
          email: profile.email,
          displayName: profile.name?.trim() || displayNameFromEmail(profile.email),
          provider,
          providerUserId: profile.subject,
        });
        user = await this.getUserOrThrow(created.userId);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        user = await this.findActiveUserByEmail(profile.email);
        if (!user) {
          throw unauthorized('登录失败');
        }
      }
    }

    const response = await this.establishSession(user, input.device);
    await this.audit.record({
      userId: user.id,
      event: `login_${provider}`,
      ip,
      metadata: { deviceId: response.deviceId },
    });
    return response;
  }

  async refresh(input: RefreshRequestInput): Promise<AuthResponseDto> {
    const hash = this.tokens.hashRefreshToken(input.refreshToken);
    const [token] = await this.database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    if (!token) {
      throw unauthorized('刷新令牌无效');
    }

    if (token.revokedAt || token.rotatedAt) {
      await this.revokeFamilyForReplay(token.familyId, token.userId, token.deviceId);
      throw unauthorized('刷新令牌已失效，请重新登录');
    }
    if (token.expiresAt <= new Date()) {
      throw unauthorized('刷新令牌已过期');
    }

    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, token.userId))
      .limit(1);
    const [device] = await this.database.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, token.deviceId), eq(devices.userId, token.userId)))
      .limit(1);
    if (!user || user.deletedAt || !device || device.revokedAt) {
      throw unauthorized('会话已失效');
    }

    const newTokenPlain = this.tokens.generateRefreshToken();
    const newTokenId = newId();
    const rotated = await this.database.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, token.id))
        .for('update')
        .limit(1);
      if (!locked) {
        return false;
      }
      if (locked.rotatedAt || locked.revokedAt) {
        return false;
      }
      await tx.insert(refreshTokens).values({
        id: newTokenId,
        userId: token.userId,
        deviceId: token.deviceId,
        familyId: token.familyId,
        tokenHash: this.tokens.hashRefreshToken(newTokenPlain),
        expiresAt: addDays(new Date(), this.config.refreshTokenTtlDays),
      });
      await tx
        .update(refreshTokens)
        .set({ rotatedAt: new Date(), replacedById: newTokenId })
        .where(eq(refreshTokens.id, token.id));
      return true;
    });

    if (!rotated) {
      await this.revokeFamilyForReplay(token.familyId, token.userId, token.deviceId);
      throw unauthorized('刷新令牌已失效，请重新登录');
    }

    const access = await this.tokens.signAccessToken({
      uid: user.id,
      did: device.id,
      authVersion: user.authVersion,
      deviceAuthVersion: device.authVersion,
    });
    return {
      accessToken: access.token,
      refreshToken: newTokenPlain,
      expiresIn: access.expiresIn,
      deviceId: device.id,
      user: toUserDto(user),
    };
  }

  async logout(userId: string, deviceId: string, ip: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            eq(refreshTokens.deviceId, deviceId),
            isNull(refreshTokens.revokedAt),
          ),
        );
      await tx
        .update(devices)
        .set({ authVersion: sql`${devices.authVersion} + 1`, pushToken: null })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
    });
    await this.audit.record({ userId, event: 'logout', ip, metadata: { deviceId } });
  }

  async logoutAll(userId: string, ip: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await tx
        .update(users)
        .set({ authVersion: sql`${users.authVersion} + 1` })
        .where(eq(users.id, userId));
      await tx
        .update(devices)
        .set({ authVersion: sql`${devices.authVersion} + 1`, pushToken: null })
        .where(eq(devices.userId, userId));
    });
    await this.audit.record({ userId, event: 'logout_all', ip });
  }

  private async establishSession(
    user: UserRow,
    deviceInfo: DeviceInfoInput,
  ): Promise<AuthResponseDto> {
    const device = await this.findOrCreateDevice(user.id, deviceInfo);
    const refreshToken = this.tokens.generateRefreshToken();
    await this.database.db.insert(refreshTokens).values({
      id: newId(),
      userId: user.id,
      deviceId: device.id,
      familyId: newId(),
      tokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt: addDays(new Date(), this.config.refreshTokenTtlDays),
    });
    const access = await this.tokens.signAccessToken({
      uid: user.id,
      did: device.id,
      authVersion: user.authVersion,
      deviceAuthVersion: device.authVersion,
    });
    return {
      accessToken: access.token,
      refreshToken,
      expiresIn: access.expiresIn,
      deviceId: device.id,
      user: toUserDto(user),
    };
  }

  private async findOrCreateDevice(userId: string, info: DeviceInfoInput): Promise<DeviceRow> {
    const appVersion = info.appVersion ?? null;
    const osVersion = info.osVersion ?? null;
    const [existing] = await this.database.db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.userId, userId),
          eq(devices.name, info.name),
          eq(devices.platform, info.platform),
          appVersion === null ? isNull(devices.appVersion) : eq(devices.appVersion, appVersion),
          osVersion === null ? isNull(devices.osVersion) : eq(devices.osVersion, osVersion),
          isNull(devices.revokedAt),
        ),
      )
      .limit(1);

    if (existing) {
      await this.database.db
        .update(devices)
        .set({ lastSeenAt: new Date() })
        .where(eq(devices.id, existing.id));
      return existing;
    }

    const [active] = await this.database.db
      .select({ value: count() })
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
    if (Number(active?.value ?? 0) >= this.config.maxDevices) {
      throw forbidden('登录设备数量已达上限，请移除旧设备后重试');
    }

    const [created] = await this.database.db
      .insert(devices)
      .values({
        id: newId(),
        userId,
        name: info.name,
        platform: info.platform,
        appVersion,
        osVersion,
      })
      .returning();
    if (!created) {
      throw new Error('Failed to create device');
    }
    return created;
  }

  private async revokeFamilyForReplay(
    familyId: string,
    userId: string,
    deviceId: string,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
      await tx
        .update(devices)
        .set({ authVersion: sql`${devices.authVersion} + 1` })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
    });
    await this.audit.record({
      userId,
      event: 'refresh_replay',
      metadata: { familyId, deviceId },
    });
    this.logger.warn(`Refresh token replay detected for user=${userId}; family revoked`);
  }

  private async findActiveUserByEmail(email: string): Promise<UserRow | null> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
      .limit(1);
    return user ?? null;
  }

  private async findDeletedUserByEmail(email: string): Promise<UserRow | null> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), isNotNull(users.deletedAt)))
      .limit(1);
    return user ?? null;
  }

  private async findActiveUserById(userId: string): Promise<UserRow | null> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return user ?? null;
  }

  private async getUserOrThrow(userId: string): Promise<UserRow> {
    const user = await this.findActiveUserById(userId);
    if (!user) {
      throw unauthorized('登录失败');
    }
    return user;
  }

  private async findIdentity(provider: string, subject: string) {
    const [row] = await this.database.db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.provider, provider), eq(authIdentities.providerUserId, subject)))
      .limit(1);
    return row ?? null;
  }

  private async linkIdentity(
    userId: string,
    provider: string,
    providerUserId: string,
  ): Promise<void> {
    await this.database.db.insert(authIdentities).values({
      id: newId(),
      userId,
      provider,
      providerUserId,
    });
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return (local.trim() || '用户').slice(0, 50);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
