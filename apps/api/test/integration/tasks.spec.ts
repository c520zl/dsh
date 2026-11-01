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

async function createList(ctx: TestApp, user: TestUser, name: string): Promise<any> {
  const response = await ctx.http.post('/lists', { name }, user.token, {
    'idempotency-key': randomUUID(),
  });
  expect(response.status).toBe(201);
  return response.body;
}

describe('lists', () => {
  it('creates, lists, renames and archives custom lists', async () => {
    const user = await registerUser(ctx);
    const list = await createList(ctx, user, '工作');
    expect(list).toMatchObject({ name: '工作', isDefault: false, isArchived: false, version: 1 });

    const duplicate = await ctx.http.post('/lists', { name: '工作' }, user.token);
    expect(duplicate.status).toBe(400);

    const renamed = await ctx.http.patch(
      `/lists/${list.id}`,
      { name: '工作项目', color: 'teal', icon: 'briefcase' },
      user.token,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      name: '工作项目',
      color: 'teal',
      icon: 'briefcase',
      version: 2,
    });

    const archived = await ctx.http.patch(`/lists/${list.id}`, { isArchived: true }, user.token);
    expect(archived.body.isArchived).toBe(true);
    const visible = await ctx.http.get('/lists', user.token);
    expect(visible.body.map((item: { id: string }) => item.id)).not.toContain(list.id);
    const all = await ctx.http.get('/lists?includeArchived=true', user.token);
    expect(all.body.map((item: { id: string }) => item.id)).toContain(list.id);
  });

  it('is idempotent for the same Idempotency-Key', async () => {
    const user = await registerUser(ctx);
    const key = randomUUID();
    const first = await ctx.http.post('/lists', { name: '幂等清单' }, user.token, {
      'idempotency-key': key,
    });
    const second = await ctx.http.post('/lists', { name: '幂等清单' }, user.token, {
      'idempotency-key': key,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const lists = await ctx.http.get('/lists', user.token);
    expect(lists.body.filter((item: { name: string }) => item.name === '幂等清单')).toHaveLength(1);
  });

  it('moves tasks to the inbox when a list is deleted', async () => {
    const user = await registerUser(ctx);
    const list = await createList(ctx, user, '临时清单');
    const task = await createTask(ctx, user, { listId: list.id, title: '随清单移动' });
    const deleted = await ctx.http.delete(`/lists/${list.id}`, {}, user.token);
    expect(deleted.status).toBe(204);
    const moved = await ctx.http.get(`/tasks/${task.id}`, user.token);
    expect(moved.status).toBe(200);
    expect(moved.body.listId).toBe(user.inboxId);
    expect(moved.body.version).toBe(2);
    const lists = await ctx.http.get('/lists', user.token);
    expect(lists.body.map((item: { id: string }) => item.id)).not.toContain(list.id);
  });

  it('soft-deletes tasks when a list is deleted with delete_tasks', async () => {
    const user = await registerUser(ctx);
    const list = await createList(ctx, user, '删除任务清单');
    const task = await createTask(ctx, user, { listId: list.id, title: '随清单删除' });
    const deleted = await ctx.http.delete(
      `/lists/${list.id}`,
      { taskAction: 'delete_tasks' },
      user.token,
    );
    expect(deleted.status).toBe(204);
    const trash = await ctx.http.get('/tasks?view=trash', user.token);
    expect(trash.body.items.map((item: { id: string }) => item.id)).toContain(task.id);
    const restore = await ctx.http.post(`/tasks/${task.id}/restore`, {}, user.token);
    expect(restore.status).toBe(409);
  });

  it('does not delete the default inbox', async () => {
    const user = await registerUser(ctx);
    const response = await ctx.http.delete(`/lists/${user.inboxId}`, {}, user.token);
    expect(response.status).toBe(400);
  });
});

describe('tasks', () => {
  it('creates and validates a task with all supported fields', async () => {
    const user = await registerUser(ctx);
    const valid = await createTask(ctx, user, {
      title: '  写周报  ',
      notes: '本周总结',
      priority: 3,
      dueDate: '2026-12-01',
      reminderSpec: [{ id: randomUUID(), offsetMinutes: -30 }],
    });
    expect(valid.title).toBe('写周报');
    expect(valid.priority).toBe(3);
    expect(valid.dueDate).toBe('2026-12-01');
    expect(valid.reminderSpec).toHaveLength(1);
    expect(valid.version).toBe(1);

    const missingTitle = await ctx.http.post('/tasks', { title: '   ' }, user.token);
    expect(missingTitle.status).toBe(400);
    const bothDue = await ctx.http.post(
      '/tasks',
      { title: 'x', dueDate: '2026-12-01', dueAt: '2026-12-01T00:00:00.000Z' },
      user.token,
    );
    expect(bothDue.status).toBe(400);
    const reminderWithoutDue = await ctx.http.post(
      '/tasks',
      { title: 'x', reminderSpec: [{ id: randomUUID(), offsetMinutes: 0 }] },
      user.token,
    );
    expect(reminderWithoutDue.status).toBe(400);
    const unknownTag = await ctx.http.post(
      '/tasks',
      { title: 'x', tagIds: [randomUUID()] },
      user.token,
    );
    expect(unknownTag.status).toBe(400);
  });

  it('supports subtasks and moves children with their parent list', async () => {
    const user = await registerUser(ctx);
    const target = await createList(ctx, user, '父子清单');
    const parent = await createTask(ctx, user, { title: '父任务' });
    const child = await createTask(ctx, user, {
      title: '子任务',
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
    expect(child.listId).toBe(user.inboxId);

    const grandchild = await ctx.http.post(
      '/tasks',
      { title: '孙任务', parentId: child.id },
      user.token,
    );
    expect(grandchild.status).toBe(400);

    const moved = await ctx.http.patch(`/tasks/${parent.id}`, { listId: target.id }, user.token);
    expect(moved.status).toBe(200);
    const movedChild = await ctx.http.get(`/tasks/${child.id}`, user.token);
    expect(movedChild.body.listId).toBe(target.id);
    expect(movedChild.body.version).toBe(2);
  });

  it('applies If-Match version checks', async () => {
    const user = await registerUser(ctx);
    const task = await createTask(ctx, user, { title: '版本任务' });
    const stale = await ctx.http.request('PATCH', `/tasks/${task.id}`, {
      token: user.token,
      body: { title: '新标题' },
      headers: { 'if-match': '99' },
    });
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const updated = await ctx.http.request('PATCH', `/tasks/${task.id}`, {
      token: user.token,
      body: { title: '新标题' },
      headers: { 'if-match': '1' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('新标题');
    expect(updated.body.version).toBe(2);
  });

  it('completes, undoes and restores one-off tasks', async () => {
    const user = await registerUser(ctx);
    const task = await createTask(ctx, user, { title: '一次性任务' });
    const completionId = randomUUID();
    const completed = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { completionId },
      user.token,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.task.completedAt).toBeTruthy();

    const again = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { completionId: randomUUID() },
      user.token,
    );
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('already_completed');

    const undone = await ctx.http.post(
      `/tasks/${task.id}/uncomplete`,
      { completionId },
      user.token,
    );
    expect(undone.status).toBe(200);
    expect(undone.body.completedAt).toBeNull();

    const secondComplete = await ctx.http.post(
      `/tasks/${task.id}/complete`,
      { completionId: randomUUID() },
      user.token,
    );
    expect(secondComplete.body.status).toBe('completed');

    const deleted = await ctx.http.delete(`/tasks/${task.id}`, undefined, user.token);
    expect(deleted.status).toBe(204);
    expect((await ctx.http.get(`/tasks/${task.id}`, user.token)).body.deletedAt).toBeTruthy();
    const trash = await ctx.http.get('/tasks?view=trash', user.token);
    expect(trash.body.items.map((item: { id: string }) => item.id)).toContain(task.id);

    const restored = await ctx.http.post(`/tasks/${task.id}/restore`, {}, user.token);
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();
  });

  it('cascades delete to subtasks and restores them with the parent', async () => {
    const user = await registerUser(ctx);
    const parent = await createTask(ctx, user, { title: '父任务' });
    const child = await createTask(ctx, user, { title: '子任务', parentId: parent.id });
    await ctx.http.delete(`/tasks/${parent.id}`, undefined, user.token);
    const childAfter = await ctx.http.get(`/tasks/${child.id}`, user.token);
    expect(childAfter.body.deletedAt).toBeTruthy();
    const restored = await ctx.http.post(`/tasks/${parent.id}/restore`, {}, user.token);
    expect(restored.status).toBe(200);
    const childRestored = await ctx.http.get(`/tasks/${child.id}`, user.token);
    expect(childRestored.body.deletedAt).toBeNull();
  });

  it('filters today, upcoming, all, completed and trash views in the user timezone', async () => {
    const user = await registerUser(ctx, { timezone: 'Asia/Shanghai' });
    const today = DateTime.now().setZone('Asia/Shanghai').toISODate() as string;
    const yesterday = DateTime.fromISO(today, { zone: 'utc' }).minus({ days: 1 }).toISODate();
    const inThreeDays = DateTime.fromISO(today, { zone: 'utc' }).plus({ days: 3 }).toISODate();

    const overdue = await createTask(ctx, user, { title: '逾期', dueDate: yesterday });
    const dueToday = await createTask(ctx, user, { title: '今天', dueDate: today });
    const upcoming = await createTask(ctx, user, { title: '未来', dueDate: inThreeDays });
    const completedToday = await createTask(ctx, user, { title: '今天完成', dueDate: today });
    await ctx.http.post(
      `/tasks/${completedToday.id}/complete`,
      { completionId: randomUUID() },
      user.token,
    );

    const todayView = await ctx.http.get('/tasks?view=today', user.token);
    const todayIds = todayView.body.items.map((item: { id: string }) => item.id);
    expect(todayIds).toContain(overdue.id);
    expect(todayIds).toContain(dueToday.id);
    expect(todayIds).toContain(completedToday.id);
    expect(todayIds).not.toContain(upcoming.id);

    const upcomingView = await ctx.http.get('/tasks?view=upcoming', user.token);
    const upcomingIds = upcomingView.body.items.map((item: { id: string }) => item.id);
    expect(upcomingIds).toContain(upcoming.id);
    expect(upcomingIds).not.toContain(dueToday.id);

    const allView = await ctx.http.get('/tasks?view=all', user.token);
    const allIds = allView.body.items.map((item: { id: string }) => item.id);
    expect(allIds).toContain(overdue.id);
    expect(allIds).not.toContain(completedToday.id);

    const completedView = await ctx.http.get('/tasks?view=completed', user.token);
    expect(completedView.body.items.map((item: { id: string }) => item.id)).toContain(
      completedToday.id,
    );

    const q = await ctx.http.get('/tasks?q=今天&status=open', user.token);
    expect(q.body.items.map((item: { id: string }) => item.id)).toContain(dueToday.id);
  });

  it('paginates task lists with an opaque cursor', async () => {
    const user = await registerUser(ctx);
    for (let index = 0; index < 3; index += 1) {
      await createTask(ctx, user, { title: `分页 ${index}` });
    }
    const first = await ctx.http.get('/tasks?limit=2', user.token);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await ctx.http.get(
      `/tasks?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      user.token,
    );
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
    const allIds = [...first.body.items, ...second.body.items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(allIds).size).toBe(3);
  });

  it('reorders tasks and runs batch operations', async () => {
    const user = await registerUser(ctx);
    const list = await createList(ctx, user, '批处理清单');
    const first = await createTask(ctx, user, { title: 'A' });
    const second = await createTask(ctx, user, { title: 'B' });
    const reorder = await ctx.http.post(
      '/tasks/reorder',
      {
        items: [
          { taskId: first.id, sortRank: 'a1' },
          { taskId: second.id, sortRank: 'a2' },
        ],
      },
      user.token,
    );
    expect(reorder.status).toBe(204);
    const ordered = await ctx.http.get('/tasks', user.token);
    expect(ordered.body.items.map((item: { title: string }) => item.title)).toEqual(['A', 'B']);

    const batchMove = await ctx.http.post(
      '/tasks/batch',
      { action: 'move', taskIds: [first.id, second.id], targetListId: list.id },
      user.token,
      { 'idempotency-key': randomUUID() },
    );
    expect(batchMove.status).toBe(200);
    expect(batchMove.body.results.map((item: { status: string }) => item.status)).toEqual([
      'applied',
      'applied',
    ]);

    const batchComplete = await ctx.http.post(
      '/tasks/batch',
      { action: 'complete', taskIds: [first.id, second.id] },
      user.token,
    );
    expect(batchComplete.status).toBe(200);
    expect(
      batchComplete.body.results.every((item: { status: string }) => item.status === 'applied'),
    ).toBe(true);

    const batchDelete = await ctx.http.post(
      '/tasks/batch',
      { action: 'delete', taskIds: [first.id, second.id] },
      user.token,
    );
    expect(batchDelete.body.results.map((item: { status: string }) => item.status)).toEqual([
      'applied',
      'applied',
    ]);
  });

  it('creates tags, attaches them to tasks and clears them when a tag is deleted', async () => {
    const user = await registerUser(ctx);
    const tagResponse = await ctx.http.post('/tags', { name: '重要', color: 'amber' }, user.token);
    expect(tagResponse.status).toBe(201);
    const tag = tagResponse.body;
    const task = await createTask(ctx, user, { title: '带标签', tagIds: [tag.id] });
    expect(task.tagIds).toEqual([tag.id]);

    const deleted = await ctx.http.delete(`/tags/${tag.id}`, undefined, user.token);
    expect(deleted.status).toBe(204);
    const after = await ctx.http.get(`/tasks/${task.id}`, user.token);
    expect(after.body.tagIds).toEqual([]);
    expect(after.body.version).toBeGreaterThan(task.version);
    const tags = await ctx.http.get('/tags', user.token);
    expect(tags.body).toHaveLength(0);
  });
});
