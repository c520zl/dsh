import { z } from 'zod';
import type { userSettings } from '../../db/schema';
import type { UserDto } from '../../common/user.mapper';

const timeOfDay = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

export const settingsUpdateSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    accent: z.enum(['coral', 'teal', 'amber', 'indigo']).optional(),
    weekStart: z.enum(['monday', 'sunday']).optional(),
    defaultListId: z.uuid().nullable().optional(),
    defaultReminderTime: timeOfDay.optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
    quietHours: z.object({ start: timeOfDay, end: timeOfDay }).strict().nullable().optional(),
    notificationPrefs: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    avatar: z.string().max(64).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    locale: z.enum(['zh-CN', 'en']).optional(),
    settings: settingsUpdateSchema.optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export interface UserSettingsDto {
  theme: 'system' | 'light' | 'dark';
  accent: 'coral' | 'teal' | 'amber' | 'indigo';
  weekStart: 'monday' | 'sunday';
  defaultListId: string | null;
  defaultReminderTime: string;
  timeFormat: '12h' | '24h';
  quietHours: { start: string; end: string } | null;
  notificationPrefs: Record<string, boolean>;
  version: number;
}

export type SettingsRow = typeof userSettings.$inferSelect;

export function toSettingsDto(row: SettingsRow): UserSettingsDto {
  return {
    theme: row.theme as UserSettingsDto['theme'],
    accent: row.accent as UserSettingsDto['accent'],
    weekStart: row.weekStart as UserSettingsDto['weekStart'],
    defaultListId: row.defaultListId,
    defaultReminderTime: row.defaultReminderTime.slice(0, 5),
    timeFormat: row.timeFormat as UserSettingsDto['timeFormat'],
    quietHours:
      row.quietHoursStart && row.quietHoursEnd
        ? { start: row.quietHoursStart.slice(0, 5), end: row.quietHoursEnd.slice(0, 5) }
        : null,
    notificationPrefs: row.notificationPrefs,
    version: row.version,
  };
}

export interface MeResponseDto {
  user: UserDto;
  settings: UserSettingsDto;
}
