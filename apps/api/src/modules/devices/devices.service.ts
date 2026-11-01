import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { notFound } from '../../common/errors';
import { devices, refreshTokens } from '../../db/schema';
import { AuditService } from '../../core/audit.service';
import { DatabaseService } from '../../core/database.service';
import { toDeviceDto, type DeviceDto, type UpdateDeviceInput } from './device.dto';

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<DeviceDto[]> {
    const rows = await this.database.db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
    return rows.map(toDeviceDto);
  }

  async update(
    userId: string,
    deviceId: string,
    input: UpdateDeviceInput,
    ip: string,
  ): Promise<DeviceDto> {
    const [current] = await this.database.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
      .limit(1);
    if (!current) {
      throw notFound('设备不存在');
    }
    const patch: Partial<typeof devices.$inferInsert> = {};
    const metadata: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== current.name) {
      patch.name = input.name;
      metadata.name = true;
    }
    if (input.pushToken !== undefined) {
      patch.pushToken = input.pushToken;
      metadata.pushTokenChanged = true;
    }
    if (input.pushProvider !== undefined) {
      patch.pushProvider = input.pushProvider;
      metadata.pushProvider = input.pushProvider;
    }
    if (Object.keys(patch).length === 0) {
      return toDeviceDto(current);
    }
    const [updated] = await this.database.db
      .update(devices)
      .set(patch)
      .where(eq(devices.id, deviceId))
      .returning();
    if (!updated) {
      throw notFound('设备不存在');
    }
    await this.audit.record({ userId, event: 'device_updated', ip, metadata });
    return toDeviceDto(updated);
  }

  async revoke(userId: string, deviceId: string, ip: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
        .limit(1);
      if (!current) {
        throw notFound('设备不存在');
      }
      if (current.revokedAt) {
        return;
      }
      const now = new Date();
      await tx
        .update(devices)
        .set({
          revokedAt: now,
          authVersion: sql`${devices.authVersion} + 1`,
          pushToken: null,
          pushProvider: null,
        })
        .where(eq(devices.id, deviceId));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            eq(refreshTokens.deviceId, deviceId),
            isNull(refreshTokens.revokedAt),
          ),
        );
    });
    await this.audit.record({ userId, event: 'device_revoked', ip, metadata: { deviceId } });
  }
}
