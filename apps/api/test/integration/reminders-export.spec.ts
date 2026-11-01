import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestApp, registerUser, type TestApp } from '../helpers/test-app';
import { DatabaseService } from '../../src/core/database.service';
import { ReminderService } from '../../src/core/reminder.service';
import { ExportService } from '../../src/modules/export/export.service';
import { CleanupService } from '../../src/core/cleanup.service';
import { reminders } from '../../src/db/schema';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe('reminders', () => {
  it('materializes due reminders and dispatches them once', async () => {
    const user = await registerUser(ctx);
    const reminderId = randomUUID();
    const dueAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const created = await ctx.http.post(
      '/tasks',
      {
        title: '准时提醒我',
        dueAt,
        reminderSpec: [{ id: reminderId, offsetMinutes: -10 }],
      },
      user.token,
    );
    expect(created.status).toBe(201);

    const database = ctx.app.get(DatabaseService);
    const [row] = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.taskId, created.body.id))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row?.reminderKey).toBe(reminderId);
    expect(row?.status).toBe('pending');
    expect(row?.occurrenceKey).toBe(`at:${new Date(dueAt).toISOString()}`);
    expect(Math.abs((row!.remindAt.getTime() - (Date.now() + 0)) / 1000)).toBeLessThan(60);

    const remindersService = ctx.app.get(ReminderService);
    const dispatched = await remindersService.dispatchDue(100);
    expect(dispatched).toBeGreaterThanOrEqual(1);
    const [after] = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, row!.id))
      .limit(1);
    expect(after?.status).toBe('sent');
    expect(after?.sentAt).toBeTruthy();

    // A second tick does not deliver the same reminder again.
    await remindersService.dispatchDue(100);
    const [again] = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, row!.id))
      .limit(1);
    expect(again?.status).toBe('sent');
    expect(again?.attemptCount).toBe(after?.attemptCount);
  });

  it('cancels stale reminders when the task changes', async () => {
    const user = await registerUser(ctx);
    const reminderId = randomUUID();
    const created = await ctx.http.post(
      '/tasks',
      {
        title: '改期任务',
        dueDate: '2026-12-20',
        reminderSpec: [{ id: reminderId, offsetMinutes: -60 }],
      },
      user.token,
    );
    expect(created.status).toBe(201);
    const updated = await ctx.http.patch(
      `/tasks/${created.body.id}`,
      { dueDate: '2026-12-21' },
      user.token,
    );
    expect(updated.status).toBe(200);

    const database = ctx.app.get(DatabaseService);
    const rows = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.reminderKey, reminderId));
    const pending = rows.filter((row) => row.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.remindAt.toISOString()).toContain('2026-12-21');
    expect(rows.some((row) => row.status === 'canceled')).toBe(true);
  });
});

describe('exports', () => {
  it('creates a JSON export, generates the file and downloads it', async () => {
    const user = await registerUser(ctx);
    await ctx.http.post(
      '/tasks',
      { title: '导出任务', notes: '包含备注', dueDate: '2026-12-25' },
      user.token,
    );
    const created = await ctx.http.post('/export', { format: 'json' }, user.token);
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('pending');

    const exportService = ctx.app.get(ExportService);
    const processed = await exportService.processPending(10);
    expect(processed).toBeGreaterThanOrEqual(1);

    const job = await ctx.http.get(`/export/${created.body.id}`, user.token);
    expect(job.status).toBe(200);
    expect(job.body.status).toBe('ready');
    expect(job.body.downloadUrl).toContain(`/v1/export/${created.body.id}/download`);

    const download = await ctx.http.get(`/export/${created.body.id}/download`, user.token);
    expect(download.status).toBe(200);
    const payload = typeof download.body === 'string' ? JSON.parse(download.body) : download.body;
    expect(payload.user.email).toBe(user.email);
    expect(payload.tasks.some((task: { title: string }) => task.title === '导出任务')).toBe(true);
    expect(payload.settings.defaultListId).toBe(user.inboxId);

    const other = await registerUser(ctx);
    expect((await ctx.http.get(`/export/${created.body.id}`, other.token)).status).toBe(404);
    expect((await ctx.http.get(`/export/${created.body.id}/download`, other.token)).status).toBe(
      404,
    );
  });

  it('runs retention cleanup without errors', async () => {
    const cleanup = ctx.app.get(CleanupService);
    const stats = await cleanup.run();
    expect(stats).toHaveProperty('reminders');
    expect(stats).toHaveProperty('changeLog');
    expect(stats).toHaveProperty('users');
  });

  it('creates a CSV export with a task header and rows', async () => {
    const user = await registerUser(ctx);
    await ctx.http.post('/tasks', { title: 'CSV 任务,带逗号', notes: 'line1\nline2' }, user.token);
    const created = await ctx.http.post('/export', { format: 'csv' }, user.token);
    expect(created.status).toBe(202);
    const exportService = ctx.app.get(ExportService);
    await exportService.processPending(10);
    const job = await ctx.http.get(`/export/${created.body.id}`, user.token);
    expect(job.body.status).toBe('ready');
    const download = await ctx.http.get(`/export/${created.body.id}/download`, user.token);
    expect(download.status).toBe(200);
    expect(download.raw).toContain('id,listId,parentId,title');
    expect(download.raw).toContain('CSV 任务');
  });
});
