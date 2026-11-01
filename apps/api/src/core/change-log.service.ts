import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Transaction } from './database.service';

export type ChangeEntity = 'task' | 'list' | 'tag';

export interface AppendChangeInput {
  userId: string;
  entity: ChangeEntity;
  entityId: string;
  version: number;
  op: 'upsert' | 'delete';
  changedFields: Record<string, unknown>;
  deviceId?: string | null;
}

@Injectable()
export class ChangeLogService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Appends a change row using the canonical sync.append_change() function,
   * which allocates the per-user sequence under an advisory lock.
   */
  async append(tx: Transaction, input: AppendChangeInput): Promise<number> {
    const rows = await tx.execute<{ seq: number | string }>(sql`
      select sync.append_change(
        ${input.userId}::uuid,
        ${input.entity},
        ${input.entityId}::uuid,
        ${input.version}::bigint,
        ${input.op},
        ${JSON.stringify(input.changedFields)}::jsonb,
        ${input.deviceId ?? null}::uuid
      ) as seq
    `);
    const first = rows[0] as { seq: number | string } | undefined;
    if (!first) {
      throw new Error('sync.append_change() returned no sequence');
    }
    return Number(first.seq);
  }

  get retentionDays(): number {
    return this.config.changeLogRetentionDays;
  }
}
