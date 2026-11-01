import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { notFound } from '../../common/errors';
import { toSettingsDto } from '../me/me.dto';
import { toListDto } from '../lists/list.dto';
import { toTagDto } from '../tags/tag.dto';
import { toTaskDto } from '../tasks/task.dto';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { newId } from '../../domain/ids';
import { addDays } from '../../domain/time';
import {
  exportJobs,
  lists,
  reminders,
  tags,
  taskTags,
  tasks,
  userSettings,
  users,
} from '../../db/schema';
import { AuditService } from '../../core/audit.service';
import { DatabaseService } from '../../core/database.service';

type ExportRow = typeof exportJobs.$inferSelect;

export interface ExportJobDto {
  id: string;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'expired';
  format: 'json' | 'csv';
  downloadUrl: string | null;
  expiresAt: string | null;
  error: string | null;
  createdAt: string;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, format: 'json' | 'csv', ip: string): Promise<ExportJobDto> {
    const [job] = await this.database.db
      .insert(exportJobs)
      .values({ id: newId(), userId, format, status: 'pending' })
      .returning();
    if (!job) {
      throw new Error('Failed to create export job');
    }
    await this.audit.record({ userId, event: 'export_requested', ip, metadata: { format } });
    return this.toDto(job);
  }

  async get(userId: string, exportId: string): Promise<ExportJobDto> {
    const [job] = await this.database.db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, exportId), eq(exportJobs.userId, userId)))
      .limit(1);
    if (!job) {
      throw notFound('导出任务不存在');
    }
    if (job.status === 'ready' && job.expiresAt && job.expiresAt <= new Date()) {
      const [expired] = await this.database.db
        .update(exportJobs)
        .set({ status: 'expired' })
        .where(eq(exportJobs.id, job.id))
        .returning();
      return this.toDto(expired ?? { ...job, status: 'expired' });
    }
    return this.toDto(job);
  }

  async getDownload(
    userId: string,
    exportId: string,
  ): Promise<{ path: string; filename: string; mime: string }> {
    const [job] = await this.database.db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, exportId), eq(exportJobs.userId, userId)))
      .limit(1);
    if (!job || job.status !== 'ready' || !job.storageKey) {
      throw notFound('导出文件不存在或尚未生成');
    }
    if (!job.expiresAt || job.expiresAt <= new Date()) {
      await this.database.db
        .update(exportJobs)
        .set({ status: 'expired' })
        .where(eq(exportJobs.id, job.id));
      throw notFound('导出文件已过期');
    }
    const root = resolve(this.config.storageDir);
    const filePath = resolve(root, job.storageKey);
    if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
      throw notFound('导出文件不存在');
    }
    if (!existsSync(filePath)) {
      throw notFound('导出文件不存在');
    }
    return {
      path: filePath,
      filename: `todo-export-${job.id}.${job.format}`,
      mime: job.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
    };
  }

  async readDownload(
    userId: string,
    exportId: string,
  ): Promise<{
    filename: string;
    mime: string;
    body: Buffer;
  }> {
    const download = await this.getDownload(userId, exportId);
    return {
      filename: download.filename,
      mime: download.mime,
      body: await readFile(download.path),
    };
  }

  async streamDownload(userId: string, exportId: string) {
    const download = await this.getDownload(userId, exportId);
    return { ...download, stream: createReadStream(download.path) };
  }

  async processPending(limit = 5): Promise<number> {
    const claimed = await this.database.db.execute<{ id: string }>(sql`
      with due as (
        select id from ops.export_jobs
        where status = 'pending'
        order by created_at
        limit ${limit}
        for update skip locked
      )
      update ops.export_jobs j
      set status = 'processing'
      from due
      where j.id = due.id
      returning j.id
    `);
    const ids = (Array.from(claimed) as Array<{ id: string }>).map((row) => row.id);
    for (const id of ids) {
      await this.processOne(id);
    }
    return ids.length;
  }

  async resetStale(): Promise<number> {
    const result = await this.database.db
      .update(exportJobs)
      .set({ status: 'pending' })
      .where(
        and(
          eq(exportJobs.status, 'processing'),
          sql`${exportJobs.updatedAt} < now() - interval '10 minutes'`,
        ),
      )
      .returning({ id: exportJobs.id });
    return result.length;
  }

  async purgeExpired(): Promise<number> {
    const cutoff = addDays(new Date(), -7).toISOString();
    const rows = await this.database.db
      .select()
      .from(exportJobs)
      .where(sql`${exportJobs.createdAt} < ${cutoff}::timestamptz`);
    for (const row of rows) {
      if (row.storageKey) {
        await this.removeFile(row.storageKey);
      }
    }
    const deleted = await this.database.db
      .delete(exportJobs)
      .where(sql`${exportJobs.createdAt} < ${cutoff}::timestamptz`)
      .returning({ id: exportJobs.id });
    return deleted.length;
  }

  private async processOne(exportId: string): Promise<void> {
    const [job] = await this.database.db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, exportId))
      .limit(1);
    if (!job) {
      return;
    }
    try {
      const root = resolve(this.config.storageDir);
      await mkdir(root, { recursive: true });
      const storageKey = `${job.id}.${job.format}`;
      const filePath = resolve(root, storageKey);
      const content =
        job.format === 'csv' ? await this.buildCsv(job.userId) : await this.buildJson(job.userId);
      await writeFile(filePath, content, 'utf8');
      await this.database.db
        .update(exportJobs)
        .set({
          status: 'ready',
          storageKey,
          expiresAt: new Date(Date.now() + this.config.exportTtlHours * 3_600_000),
          error: null,
        })
        .where(eq(exportJobs.id, job.id));
    } catch (error) {
      this.logger.error({ exportId, err: error }, 'Failed to generate export');
      await this.database.db
        .update(exportJobs)
        .set({
          status: 'failed',
          error: (error instanceof Error ? error.message : 'export failed').slice(0, 500),
        })
        .where(eq(exportJobs.id, job.id));
    }
  }

  private async buildJson(userId: string): Promise<string> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new Error('User not found');
    }
    const [settings] = await this.database.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const listRows = await this.database.db.select().from(lists).where(eq(lists.userId, userId));
    const tagRows = await this.database.db.select().from(tags).where(eq(tags.userId, userId));
    const taskRows = await this.database.db.select().from(tasks).where(eq(tasks.userId, userId));
    const tagLinks = await this.database.db
      .select()
      .from(taskTags)
      .where(eq(taskTags.userId, userId));
    const tagLinksMap = new Map<string, string[]>();
    for (const link of tagLinks) {
      const list = tagLinksMap.get(link.taskId) ?? [];
      list.push(link.tagId);
      tagLinksMap.set(link.taskId, list);
    }
    const reminderRows = await this.database.db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, userId));

    return `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatar: user.avatar,
          timezone: user.timezone,
          locale: user.locale,
          createdAt: user.createdAt.toISOString(),
          deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
        },
        settings: settings ? toSettingsDto(settings) : null,
        lists: listRows.map((row) => ({
          ...toListDto(row),
          deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
        })),
        tags: tagRows.map((row) => ({
          ...toTagDto(row),
          deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
        })),
        tasks: taskRows.map((row) => toTaskDto(row, tagLinksMap.get(row.id) ?? [])),
        reminders: reminderRows.map((row) => ({
          id: row.id,
          taskId: row.taskId,
          reminderKey: row.reminderKey,
          occurrenceKey: row.occurrenceKey,
          remindAt: row.remindAt.toISOString(),
          status: row.status,
          sentAt: row.sentAt ? row.sentAt.toISOString() : null,
        })),
        attachments: [],
      },
      null,
      2,
    )}\n`;
  }

  private async buildCsv(userId: string): Promise<string> {
    const taskRows = await this.database.db
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .orderBy(desc(tasks.createdAt));
    const header = [
      'id',
      'listId',
      'parentId',
      'title',
      'notes',
      'priority',
      'dueDate',
      'dueAt',
      'completedAt',
      'lastCompletedAt',
      'recurrenceRule',
      'recurrenceUntil',
      'recurrenceCountRemaining',
      'recurrenceSeq',
      'recurrenceTimezone',
      'sortRank',
      'version',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ];
    const lines = [header.join(',')];
    for (const row of taskRows) {
      lines.push(
        [
          row.id,
          row.listId,
          row.parentId,
          row.title,
          row.notes,
          row.priority,
          row.dueDate,
          row.dueAt?.toISOString(),
          row.completedAt?.toISOString(),
          row.lastCompletedAt?.toISOString(),
          row.recurrenceRule,
          row.recurrenceUntil,
          row.recurrenceCountRemaining,
          row.recurrenceSeq,
          row.recurrenceTimezone,
          row.sortRank,
          row.version,
          row.createdAt.toISOString(),
          row.updatedAt.toISOString(),
          row.deletedAt?.toISOString(),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private async removeFile(storageKey: string): Promise<void> {
    const root = resolve(this.config.storageDir);
    const filePath = resolve(root, storageKey);
    if (!filePath.startsWith(`${root}${sep}`)) {
      return;
    }
    await unlink(filePath).catch(() => undefined);
  }

  private toDto(job: ExportRow): ExportJobDto {
    const ready = job.status === 'ready' && job.expiresAt !== null && job.expiresAt > new Date();
    return {
      id: job.id,
      status: job.status as ExportJobDto['status'],
      format: job.format as 'json' | 'csv',
      downloadUrl: ready ? `${this.config.publicBaseUrl}/v1/export/${job.id}/download` : null,
      expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
    };
  }
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
