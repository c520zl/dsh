import { z } from 'zod';
import type { devices } from '../../db/schema';

export const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    pushToken: z.string().max(512).nullable().optional(),
    pushProvider: z
      .enum(['apns', 'fcm', 'expo', 'huawei', 'xiaomi', 'oppo', 'vivo', 'jpush', 'getui'])
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export interface DeviceDto {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'web';
  pushProvider:
    'apns' | 'fcm' | 'expo' | 'huawei' | 'xiaomi' | 'oppo' | 'vivo' | 'jpush' | 'getui' | null;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export type DeviceRow = typeof devices.$inferSelect;

export function toDeviceDto(row: DeviceRow): DeviceDto {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform as DeviceDto['platform'],
    pushProvider: row.pushProvider as DeviceDto['pushProvider'],
    lastSeenAt: row.lastSeenAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
