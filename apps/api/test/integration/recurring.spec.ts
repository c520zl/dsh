import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import {
  createTask,
  createTestApp,
  registerUser,
  type TestApp,
  type TestUser,
} from '../helpers/test-app';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

function occurrenceKey(dueAt: string): string {
  return `at:${new Date(dueAt).toISOString()}`;
}

async function createWeeklyTask(user: TestUser): Promise<any> {
  let start = DateTime.now()
    .setZone('Asia/Shanghai')
    .plus({ days: 1 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  while (start.weekday !== 1) {
    start = start.plus({ days: 1 });
  }
  const dueAt = start.toUTC().toISO() as string;
  const task = await createTask(ctx, user, {
    title: '每周站会',
    dueAt,
    recurrence: {
      rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
      timezone: 'Asia/Shanghai',
      dtstart: dueAt,
      until: null,
      countRemaining: 3,
      seq: 0,
    },
  });
  return { task, start, dueAt };
}

describe('recurring tasks', () => {
  it('advances the current instance after completion and is idempotent per occurrence', async () => {
    const user = await registerUser(ctx, { timezone: 'Asia/Shanghai' });
    const { task, start, dueAt } = await createWeeklyTask(user);
    const completionId = randomUUID();

    const completed = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId },
      user.token,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.task.completedAt).toBeNull();
    expect(completed.body.task.lastCompletedAt).toBeTruthy();
    expect(completed.body.task.recurrence.seq).toBe(1);
    expect(completed.body.task.recurrence.countRemaining).toBe(2);
    const expectedNext = start.plus({ days: 7 }).toUTC().toISO();
    expect(completed.body.task.dueAt).toBe(expectedNext);

    const duplicate = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId: randomUUID() },
      user.token,
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.status).toBe('already_completed');
    expect(duplicate.body.task.dueAt).toBe(expectedNext);

    const staleKey = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId: randomUUID() },
      user.token,
    );
    expect(staleKey.status).toBe(200);
  });

  it('undoes the latest completion and restores the previous occurrence', async () => {
    const user = await registerUser(ctx, { timezone: 'Asia/Shanghai' });
    const { task, dueAt } = await createWeeklyTask(user);
    const completionId = randomUUID();
    const completed = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId },
      user.token,
    );
    expect(completed.status).toBe(200);
    const undone = await ctx.http.post(
      `/tasks/${task.id}/uncomplete`,
      { completionId },
      user.token,
    );
    expect(undone.status).toBe(200);
    expect(undone.body.dueAt).toBe(new Date(dueAt).toISOString());
    expect(undone.body.recurrence.seq).toBe(0);
    expect(undone.body.recurrence.countRemaining).toBe(3);
    expect(undone.body.lastCompletedAt).toBeNull();

    const redo = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId: randomUUID() },
      user.token,
    );
    expect(redo.body.status).toBe('completed');
  });

  it('ends the series when the remaining count reaches zero', async () => {
    const user = await registerUser(ctx, { timezone: 'Asia/Shanghai' });
    const start = DateTime.now()
      .setZone('Asia/Shanghai')
      .plus({ days: 1 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    const dueAt = start.toUTC().toISO() as string;
    const task = await createTask(ctx, user, {
      title: '最后一次',
      dueAt,
      recurrence: {
        rule: 'FREQ=DAILY',
        timezone: 'Asia/Shanghai',
        dtstart: dueAt,
        countRemaining: 1,
        seq: 0,
      },
    });
    const completed = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId: randomUUID() },
      user.token,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.task.completedAt).toBeTruthy();
    expect(completed.body.task.recurrence.countRemaining).toBe(0);
  });

  it('ends the series when the next occurrence passes the until date', async () => {
    const user = await registerUser(ctx, { timezone: 'Asia/Shanghai' });
    const start = DateTime.now()
      .setZone('Asia/Shanghai')
      .plus({ days: 1 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    const dueAt = start.toUTC().toISO() as string;
    const task = await createTask(ctx, user, {
      title: '截止日期',
      dueAt,
      recurrence: {
        rule: 'FREQ=DAILY',
        timezone: 'Asia/Shanghai',
        dtstart: dueAt,
        until: start.toISODate(),
        countRemaining: null,
        seq: 0,
      },
    });
    const completed = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: occurrenceKey(dueAt), completionId: randomUUID() },
      user.token,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.task.completedAt).toBeTruthy();
  });

  it('skips overdue all-day instances to the current local date', async () => {
    const user = await registerUser(ctx, { timezone: 'Asia/Shanghai' });
    const today = DateTime.now().setZone('Asia/Shanghai').toISODate() as string;
    const threeWeeksAgo = DateTime.fromISO(today, { zone: 'utc' })
      .minus({ days: 21 })
      .toISODate() as string;
    const task = await createTask(ctx, user, {
      title: '逾期重复',
      dueDate: threeWeeksAgo,
      recurrence: {
        rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
        timezone: 'Asia/Shanghai',
        dtstart: `${threeWeeksAgo}T01:00:00.000Z`,
        until: null,
        countRemaining: 10,
        seq: 0,
      },
    });
    const completed = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { occurrenceKey: `date:${threeWeeksAgo}`, completionId: randomUUID() },
      user.token,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.task.dueDate).not.toBe(threeWeeksAgo);
    const dueDate = completed.body.task.dueDate as string;
    expect(dueDate >= today).toBe(true);
    expect(completed.body.task.recurrence.countRemaining).toBeLessThan(10);
  });

  it('rejects invalid recurrence rules and missing anchors', async () => {
    const user = await registerUser(ctx);
    const invalid = await ctx.http.post(
      '/tasks',
      {
        title: 'bad',
        dueDate: '2026-12-01',
        recurrence: {
          rule: 'FREQ=DAILY;BYSETPOS=1',
          timezone: 'UTC',
          dtstart: '2026-12-01T00:00:00.000Z',
          seq: 0,
        },
      },
      user.token,
    );
    expect(invalid.status).toBe(400);
    const noDue = await ctx.http.post(
      '/tasks',
      {
        title: 'bad',
        recurrence: {
          rule: 'FREQ=DAILY',
          timezone: 'UTC',
          dtstart: '2026-12-01T00:00:00.000Z',
          seq: 0,
        },
      },
      user.token,
    );
    expect(noDue.status).toBe(400);
    const badTimezone = await ctx.http.post(
      '/tasks',
      {
        title: 'bad',
        dueDate: '2026-12-01',
        recurrence: {
          rule: 'FREQ=DAILY',
          timezone: 'Nope/Nope',
          dtstart: '2026-12-01T00:00:00.000Z',
          seq: 0,
        },
      },
      user.token,
    );
    expect(badTimezone.status).toBe(400);
  });
});
