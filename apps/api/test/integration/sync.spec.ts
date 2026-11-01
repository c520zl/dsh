import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  createTask,
  createTestApp,
  registerUser,
  type TestApp,
  type TestUser,
} from '../helpers/test-app';
import { DatabaseService } from '../../src/core/database.service';
import { reminders } from '../../src/db/schema';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

async function push(
  ctx: TestApp,
  user: TestUser,
  ops: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const response = await ctx.http.post(
    '/sync/push',
    { deviceId: user.deviceId, ops, ...extra },
    user.token,
  );
  expect(response.status).toBe(200);
  return response.body;
}

describe('sync', () => {
  it('exposes a snapshot cursor and pulls incremental changes', async () => {
    const user = await registerUser(ctx);
    const snapshot = await ctx.http.get('/sync/snapshot', user.token);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.cursor).toBe(0);

    const taskId = randomUUID();
    const opId = randomUUID();
    const created = await push(ctx, user, [
      {
        opId,
        entity: 'task',
        entityId: taskId,
        op: 'create',
        patch: { title: '同步创建', listId: user.inboxId, dueDate: '2026-12-05' },
      },
    ]);
    expect(created.results[0]).toMatchObject({
      opId,
      status: 'applied',
      version: 1,
      task: { id: taskId, title: '同步创建' },
    });

    const afterCreate = await ctx.http.get('/sync/snapshot', user.token);
    expect(afterCreate.body.cursor).toBeGreaterThan(0);

    const pulled = await ctx.http.get('/sync/pull?since=0&limit=500', user.token);
    expect(pulled.status).toBe(200);
    expect(pulled.body.changes[0]).toMatchObject({
      entity: 'task',
      entityId: taskId,
      op: 'upsert',
      version: 1,
    });
    expect(pulled.body.changes[0].changedFields.title).toBe('同步创建');
    expect(pulled.body.nextCursor).toBe(afterCreate.body.cursor);

    const empty = await ctx.http.get(`/sync/pull?since=${pulled.body.nextCursor}`, user.token);
    expect(empty.body.changes).toHaveLength(0);
    expect(empty.body.hasMore).toBe(false);
  });

  it('returns the cached result for a repeated opId', async () => {
    const user = await registerUser(ctx);
    const taskId = randomUUID();
    const opId = randomUUID();
    const op = {
      opId,
      entity: 'task',
      entityId: taskId,
      op: 'create',
      patch: { title: '幂等操作', listId: user.inboxId },
    };
    const first = await push(ctx, user, [op]);
    const second = await push(ctx, user, [op]);
    expect(second.results[0].status).toBe(first.results[0].status);
    expect(second.results[0].version).toBe(first.results[0].version);
    expect(second.results[0].task.id).toBe(taskId);

    const tasks = await ctx.http.get('/tasks?view=all', user.token);
    expect(tasks.body.items.filter((item: { id: string }) => item.id === taskId)).toHaveLength(1);
  });

  it('merges non-conflicting fields and reports conflicting fields', async () => {
    const user = await registerUser(ctx);
    const task = await createTask(ctx, user, { title: '服务端标题', notes: '初始' });

    const serverUpdate = await ctx.http.patch(
      `/tasks/${task.id}`,
      { title: '服务端新标题' },
      user.token,
    );
    expect(serverUpdate.status).toBe(200);
    expect(serverUpdate.body.version).toBe(2);

    const merged = await push(ctx, user, [
      {
        opId: randomUUID(),
        entity: 'task',
        entityId: task.id,
        op: 'update',
        baseVersion: 1,
        patch: { title: '客户端标题', notes: '客户端备注' },
      },
    ]);
    expect(merged.results[0].status).toBe('conflict');
    expect(merged.results[0].conflictFields).toEqual(['title']);
    expect(merged.results[0].task.title).toBe('服务端新标题');
    expect(merged.results[0].task.notes).toBe('客户端备注');
    expect(merged.results[0].version).toBe(3);
  });

  it('applies a later baseVersion update and exposes it via pull', async () => {
    const user = await registerUser(ctx);
    const task = await createTask(ctx, user, { title: '待更新' });
    const update = await push(ctx, user, [
      {
        opId: randomUUID(),
        entity: 'task',
        entityId: task.id,
        op: 'update',
        baseVersion: task.version,
        patch: { title: '已更新', priority: 2 },
      },
    ]);
    expect(update.results[0].status).toBe('applied');
    expect(update.results[0].version).toBe(2);
    expect(update.results[0].task.title).toBe('已更新');

    const pulled = await ctx.http.get('/sync/pull?since=0', user.token);
    const last = pulled.body.changes[pulled.body.changes.length - 1];
    expect(last.entityId).toBe(task.id);
    expect(last.changedFields).toMatchObject({ title: '已更新', priority: 2 });
  });

  it('rejects an invalid op without losing valid ops in the same batch', async () => {
    const user = await registerUser(ctx);
    const validId = randomUUID();
    const result = await push(ctx, user, [
      {
        opId: randomUUID(),
        entity: 'task',
        entityId: randomUUID(),
        op: 'create',
        patch: { listId: user.inboxId },
      },
      {
        opId: randomUUID(),
        entity: 'task',
        entityId: validId,
        op: 'create',
        patch: { title: '有效操作', listId: user.inboxId },
      },
    ]);
    expect(result.results[0].status).toBe('rejected');
    expect(result.results[0].error.error.code).toBe('VALIDATION_ERROR');
    expect(result.results[1].status).toBe('applied');
    const task = await ctx.http.get(`/tasks/${validId}`, user.token);
    expect(task.status).toBe(200);
  });

  it('deletes a task through sync and is idempotent', async () => {
    const user = await registerUser(ctx);
    const task = await createTask(ctx, user, { title: '待同步删除' });
    const opId = randomUUID();
    const deleted = await push(ctx, user, [
      {
        opId,
        entity: 'task',
        entityId: task.id,
        op: 'delete',
        baseVersion: task.version,
      },
    ]);
    expect(deleted.results[0]).toMatchObject({ status: 'applied', version: 2 });
    expect((await ctx.http.get(`/tasks/${task.id}`, user.token)).body.deletedAt).toBeTruthy();

    const repeat = await push(ctx, user, [
      {
        opId: randomUUID(),
        entity: 'task',
        entityId: task.id,
        op: 'delete',
        baseVersion: 2,
      },
    ]);
    expect(repeat.results[0].status).toBe('applied');
    const pulled = await ctx.http.get('/sync/pull?since=0', user.token);
    expect(
      pulled.body.changes.some(
        (change: { entityId: string; op: string }) =>
          change.entityId === task.id && change.op === 'delete',
      ),
    ).toBe(true);
  });

  it('completes a recurring occurrence through sync without double advancing', async () => {
    const user = await registerUser(ctx);
    const dueDate = '2026-12-07';
    const task = await createTask(ctx, user, {
      title: '同步重复任务',
      dueDate,
      recurrence: {
        rule: 'FREQ=WEEKLY;BYDAY=MO',
        timezone: 'Asia/Shanghai',
        dtstart: `${dueDate}T01:00:00.000Z`,
        countRemaining: 3,
        seq: 0,
      },
    });
    const occurrenceKey = `date:${dueDate}`;
    const opId = randomUUID();
    const completed = await push(ctx, user, [
      {
        opId,
        entity: 'task',
        entityId: task.id,
        op: 'complete',
        baseVersion: task.version,
        occurrenceKey,
        completionId: randomUUID(),
      },
    ]);
    expect(completed.results[0].status).toBe('applied');
    expect(completed.results[0].task.completedAt).toBeNull();
    expect(completed.results[0].task.recurrence.seq).toBe(1);

    const duplicateOccurrence = await push(ctx, user, [
      {
        opId: randomUUID(),
        entity: 'task',
        entityId: task.id,
        op: 'complete',
        baseVersion: completed.results[0].version,
        occurrenceKey,
        completionId: randomUUID(),
      },
    ]);
    expect(duplicateOccurrence.results[0].status).toBe('already_completed');
    expect(duplicateOccurrence.results[0].task.recurrence.seq).toBe(1);
  });

  it('marks locally delivered reminders as sent', async () => {
    const user = await registerUser(ctx);
    const reminderId = randomUUID();
    const task = await createTask(ctx, user, {
      title: '本地提醒',
      dueDate: '2026-12-10',
      reminderSpec: [{ id: reminderId, offsetMinutes: -10 }],
    });
    const database = ctx.app.get(DatabaseService);
    const [reminder] = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.taskId, task.id))
      .limit(1);
    expect(reminder?.status).toBe('pending');

    await push(
      ctx,
      user,
      [
        {
          opId: randomUUID(),
          entity: 'task',
          entityId: task.id,
          op: 'update',
          baseVersion: task.version,
          patch: { notes: '触发一次合法 push' },
        },
      ],
      {
        localDeliveries: [
          {
            reminderId,
            occurrenceKey: 'date:2026-12-10',
            deliveredAt: new Date().toISOString(),
          },
        ],
      },
    );
    const [after] = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.reminderKey, reminderId))
      .limit(1);
    expect(after?.status).toBe('sent');
    expect(after?.sentAt).toBeTruthy();
  });

  it('rejects a push for a device that does not belong to the user', async () => {
    const user = await registerUser(ctx);
    const other = await registerUser(ctx);
    const response = await ctx.http.post(
      '/sync/push',
      {
        deviceId: other.deviceId,
        ops: [
          {
            opId: randomUUID(),
            entity: 'task',
            entityId: randomUUID(),
            op: 'create',
            patch: { title: 'x', listId: user.inboxId },
          },
        ],
      },
      user.token,
    );
    expect(response.status).toBe(403);
  });
});
