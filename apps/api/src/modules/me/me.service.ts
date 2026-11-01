import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../../common/errors';
import { toUserDto } from '../../common/user.mapper';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { addDays, isValidTimezone } from '../../domain/time';
import { devices, lists, refreshTokens, userSettings, users } from '../../db/schema';
import { AuditService } from '../../core/audit.service';
import { DatabaseService } from '../../core/database.service';
import { ReminderService } from '../../core/reminder.service';
import { toSettingsDto, type MeResponseDto, type UpdateMeInput } from './me.dto';

@Injectable()
export class MeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ReminderService) private readonly reminders: ReminderService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getMe(userId: string): Promise<MeResponseDto> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw notFound('用户不存在');
    }
    const [settings] = await this.database.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (!settings) {
      throw notFound('用户设置不存在');
    }
    return { user: toUserDto(user), settings: toSettingsDto(settings) };
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<MeResponseDto> {
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      throw badRequest('无效的 IANA 时区', { timezone: input.timezone });
    }

    const [currentUser] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!currentUser) {
      throw notFound('用户不存在');
    }

    if (input.settings?.defaultListId !== undefined && input.settings.defaultListId !== null) {
      const [list] = await this.database.db
        .select({ id: lists.id })
        .from(lists)
        .where(
          and(
            eq(lists.id, input.settings.defaultListId),
            eq(lists.userId, userId),
            isNull(lists.deletedAt),
          ),
        )
        .limit(1);
      if (!list) {
        throw badRequest('默认清单不存在', { defaultListId: input.settings.defaultListId });
      }
    }

    const timezoneChanged = input.timezone !== undefined && input.timezone !== currentUser.timezone;

    await this.database.db.transaction(async (tx) => {
      const userPatch: Partial<typeof users.$inferInsert> = {};
      if (input.displayName !== undefined) userPatch.displayName = input.displayName;
      if (input.avatar !== undefined) userPatch.avatar = input.avatar;
      if (input.timezone !== undefined) userPatch.timezone = input.timezone;
      if (input.locale !== undefined) userPatch.locale = input.locale;
      if (Object.keys(userPatch).length > 0) {
        await tx.update(users).set(userPatch).where(eq(users.id, userId));
      }

      if (input.settings) {
        const patch: Partial<typeof userSettings.$inferInsert> = {};
        const settings = input.settings;
        if (settings.theme !== undefined) patch.theme = settings.theme;
        if (settings.accent !== undefined) patch.accent = settings.accent;
        if (settings.weekStart !== undefined) patch.weekStart = settings.weekStart;
        if (settings.defaultListId !== undefined) patch.defaultListId = settings.defaultListId;
        if (settings.defaultReminderTime !== undefined) {
          patch.defaultReminderTime = `${settings.defaultReminderTime}:00`;
        }
        if (settings.timeFormat !== undefined) patch.timeFormat = settings.timeFormat;
        if (settings.quietHours !== undefined) {
          patch.quietHoursStart = settings.quietHours ? `${settings.quietHours.start}:00` : null;
          patch.quietHoursEnd = settings.quietHours ? `${settings.quietHours.end}:00` : null;
        }
        if (settings.notificationPrefs !== undefined) {
          patch.notificationPrefs = settings.notificationPrefs;
        }
        if (Object.keys(patch).length > 0) {
          const updated = await tx
            .update(userSettings)
            .set({ ...patch, version: sql`${userSettings.version} + 1` })
            .where(eq(userSettings.userId, userId))
            .returning({ userId: userSettings.userId });
          if (updated.length === 0) {
            await tx.insert(userSettings).values({ userId, ...patch });
          }
        }
      }
    });

    if (timezoneChanged) {
      await this.reminders.rebuildForUser(userId);
    }
    return this.getMe(userId);
  }

  async deleteMe(
    userId: string,
    ip: string,
  ): Promise<{ status: 'deletion_scheduled'; deleteAfter: string }> {
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          deletedAt: now,
          authVersion: sql`${users.authVersion} + 1`,
        })
        .where(eq(users.id, userId));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await tx
        .update(devices)
        .set({
          authVersion: sql`${devices.authVersion} + 1`,
          pushToken: null,
          pushProvider: null,
          revokedAt: now,
        })
        .where(eq(devices.userId, userId));
    });
    await this.audit.record({ userId, event: 'account_deletion_requested', ip });
    return {
      status: 'deletion_scheduled',
      deleteAfter: addDays(now, 30).toISOString(),
    };
  }
}
