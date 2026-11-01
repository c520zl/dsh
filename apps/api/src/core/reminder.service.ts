import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { newId } from '../domain/ids';
import { currentOccurrenceKey, reminderTimes } from '../domain/reminders';
import { addDays } from '../domain/time';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { devices, reminders, tasks, userSettings, users } from '../db/schema';
import { DatabaseService, type Transaction } from './database.service';
import { PushService } from './push.service';

interface ClaimedReminder {
  [key: string]: unknown;
  id: string;
  user_id: string;
  task_id: string;
  reminder_key: string;
  occurrence_key: string;
  remind_at: string | Date;
  attempt_count: number;
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /**
   * Rebuild the reminder rows for the task's current occurrence. Must be called
   * in the same transaction as the task write. Old unsent reminders are canceled
   * first; already-sent rows are never resurrected.
   */
  async rebuildForTask(tx: Transaction, taskId: string, userId: string): Promise<void> {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);

    await tx
      .update(reminders)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(reminders.taskId, taskId),
          eq(reminders.userId, userId),
          inArray(reminders.status, ['pending', 'processing']),
        ),
      );

    if (!task || task.deletedAt || task.completedAt) {
      return;
    }
    if (task.reminderSpec.length === 0 || (!task.dueDate && !task.dueAt)) {
      return;
    }
    const occurrenceKey = currentOccurrenceKey(task);
    if (!occurrenceKey) {
      return;
    }

    const [settings] = await tx
      .select({
        defaultReminderTime: userSettings.defaultReminderTime,
        timezone: users.timezone,
      })
      .from(userSettings)
      .innerJoin(users, eq(users.id, userSettings.userId))
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const materialized = reminderTimes(task, task.reminderSpec, {
      userTimezone: settings?.timezone ?? 'UTC',
      defaultReminderTime: (settings?.defaultReminderTime ?? '09:00:00').slice(0, 5),
    });

    for (const reminder of materialized) {
      await tx.execute(sql`
        insert into notify.reminders
          (id, user_id, task_id, reminder_key, occurrence_key, remind_at, status)
        values
          (${newId()}::uuid, ${userId}::uuid, ${taskId}::uuid, ${reminder.id},
           ${occurrenceKey}, ${reminder.remindAt.toISOString()}::timestamptz, 'pending')
        on conflict (task_id, occurrence_key, reminder_key, remind_at)
        do update set
          status = 'pending',
          claimed_at = null,
          sent_at = null,
          attempt_count = 0
        where notify.reminders.status <> 'sent'
      `);
    }
  }

  async rebuildForUser(userId: string): Promise<void> {
    const rows = await this.database.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.completedAt),
          sql`jsonb_array_length(${tasks.reminderSpec}) > 0`,
        ),
      )
      .limit(5000);
    for (const row of rows) {
      await this.database.db.transaction(async (tx) => {
        await this.rebuildForTask(tx, row.id, userId);
      });
    }
  }

  async processLocalDeliveries(
    tx: Transaction,
    userId: string,
    deliveries: Array<{ reminderId: string; occurrenceKey: string; deliveredAt: string }>,
  ): Promise<void> {
    for (const delivery of deliveries) {
      const deliveredAt = new Date(delivery.deliveredAt);
      if (Number.isNaN(deliveredAt.getTime())) {
        continue;
      }
      await tx
        .update(reminders)
        .set({ status: 'sent', sentAt: deliveredAt })
        .where(
          and(
            eq(reminders.reminderKey, delivery.reminderId),
            eq(reminders.userId, userId),
            eq(reminders.occurrenceKey, delivery.occurrenceKey),
            inArray(reminders.status, ['pending', 'processing', 'failed']),
          ),
        );
    }
  }

  /** Worker tick: claim due reminders atomically, then push them. */
  async dispatchDue(limit = 200): Promise<number> {
    const claimed = await this.database.db.execute<ClaimedReminder>(sql`
      with due as (
        select id
        from notify.reminders
        where status = 'pending' and remind_at <= now()
        order by remind_at
        limit ${limit}
        for update skip locked
      )
      update notify.reminders r
      set status = 'processing', claimed_at = now(), attempt_count = r.attempt_count + 1
      from due
      where r.id = due.id
      returning r.id, r.user_id, r.task_id, r.reminder_key, r.occurrence_key, r.remind_at, r.attempt_count
    `);

    const rows = Array.from(claimed) as ClaimedReminder[];
    for (const row of rows) {
      try {
        await this.dispatchOne(row);
      } catch (error) {
        this.logger.error(
          { reminderId: row.id, err: error },
          'Failed to dispatch reminder; returning it to the queue',
        );
        await this.database.db
          .update(reminders)
          .set({ status: 'pending', claimedAt: null })
          .where(eq(reminders.id, row.id));
      }
    }
    return rows.length;
  }

  async expireStale(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.database.db
      .update(reminders)
      .set({ status: 'expired' })
      .where(and(eq(reminders.status, 'pending'), lt(reminders.remindAt, cutoff)))
      .returning({ id: reminders.id });
    return result.length;
  }

  async resetStaleProcessing(): Promise<number> {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const result = await this.database.db
      .update(reminders)
      .set({ status: 'pending', claimedAt: null })
      .where(and(eq(reminders.status, 'processing'), lt(reminders.claimedAt, cutoff)))
      .returning({ id: reminders.id });
    return result.length;
  }

  async purgeOld(): Promise<number> {
    const cutoff = addDays(new Date(), -this.config.reminderRetentionDays);
    const result = await this.database.db
      .delete(reminders)
      .where(
        and(
          inArray(reminders.status, ['sent', 'failed', 'canceled', 'expired']),
          lt(reminders.createdAt, cutoff),
        ),
      )
      .returning({ id: reminders.id });
    return result.length;
  }

  private async dispatchOne(row: ClaimedReminder): Promise<void> {
    const remindAt = new Date(row.remind_at);
    const [task] = await this.database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, row.task_id), eq(tasks.userId, row.user_id)))
      .limit(1);
    if (!task || task.deletedAt || task.completedAt) {
      await this.markStatus(row.id, 'canceled');
      return;
    }
    if (task.recurrenceRule) {
      const current = currentOccurrenceKey(task);
      if (current !== row.occurrence_key) {
        await this.markStatus(row.id, 'canceled');
        return;
      }
    }
    if (Date.now() - remindAt.getTime() > 24 * 60 * 60 * 1000) {
      await this.markStatus(row.id, 'expired');
      return;
    }

    const activeDevices = await this.database.db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.userId, row.user_id),
          isNull(devices.revokedAt),
          sql`${devices.pushToken} is not null`,
        ),
      );

    if (!this.config.pushEnabled) {
      this.logger.log(
        `[push disabled] reminder=${row.id} task=${row.task_id} dueAt=${remindAt.toISOString()}`,
      );
      await this.markStatus(row.id, 'sent', new Date());
      return;
    }

    if (activeDevices.length === 0) {
      await this.markStatus(row.id, 'failed');
      return;
    }

    let delivered = false;
    let lastError: string | undefined;
    for (const device of activeDevices) {
      const result = await this.push.send(device.pushToken as string, device.pushProvider, {
        title: '待办提醒',
        body: task.title,
        data: {
          taskId: task.id,
          reminderId: row.reminder_key,
          occurrenceKey: row.occurrence_key,
        },
      });
      if (result.ok) {
        delivered = true;
      } else {
        lastError = result.error;
        if (result.invalidToken) {
          await this.database.db
            .update(devices)
            .set({ pushToken: null, pushProvider: null })
            .where(eq(devices.id, device.id));
        }
      }
    }

    if (delivered) {
      await this.markStatus(row.id, 'sent', new Date());
      return;
    }

    if (row.attempt_count > 3) {
      this.logger.warn(
        `Reminder ${row.id} failed after ${row.attempt_count} attempts: ${lastError}`,
      );
      await this.markStatus(row.id, 'failed');
      return;
    }
    await this.maybeRetry(row, reminderBackoffMinutes(row.attempt_count));
  }

  private async maybeRetry(row: ClaimedReminder, minutes: number): Promise<void> {
    try {
      await this.database.db
        .update(reminders)
        .set({
          status: 'pending',
          claimedAt: null,
          remindAt: new Date(Date.now() + minutes * 60_000),
        })
        .where(eq(reminders.id, row.id));
    } catch (error) {
      this.logger.error({ reminderId: row.id, err: error }, 'Failed to schedule reminder retry');
      await this.markStatus(row.id, 'failed');
    }
  }

  private async markStatus(
    id: string,
    status: 'sent' | 'failed' | 'canceled' | 'expired',
    sentAt?: Date,
  ): Promise<void> {
    await this.database.db
      .update(reminders)
      .set({ status, sentAt: sentAt ?? null })
      .where(eq(reminders.id, id));
  }
}

function reminderBackoffMinutes(attemptCount: number): number {
  return [1, 5, 15][Math.min(attemptCount - 1, 2)] ?? 15;
}
