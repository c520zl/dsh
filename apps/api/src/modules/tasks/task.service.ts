import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  badRequest,
  deleted,
  notFound,
  preconditionFailed,
  versionConflict,
} from '../../common/errors';
import { newId } from '../../domain/ids';
import {
  parseRecurrenceRule,
  RecurrenceRuleError,
  nextRecurrence,
  type ParsedRecurrenceRule,
} from '../../domain/recurrence';
import { newTaskSortRank } from '../../domain/sort-rank';
import { currentOccurrenceKey } from '../../domain/reminders';
import {
  addDays,
  isDateString,
  isValidTimezone,
  localDateOf,
  localDayBounds,
  nextDate,
} from '../../domain/time';
import {
  lists,
  reminders,
  taskCompletions,
  taskTags,
  tasks,
  tags,
  userSettings,
  users,
} from '../../db/schema';
import { ChangeLogService } from '../../core/change-log.service';
import { DatabaseService, type Transaction } from '../../core/database.service';
import { ReminderService } from '../../core/reminder.service';
import {
  toTaskDto,
  type BatchTaskInput,
  type BatchTaskResponseDto,
  type CompleteTaskInput,
  type CompleteTaskResponseDto,
  type CreateTaskInput,
  type ListTasksQuery,
  type ReorderTasksInput,
  type TaskDto,
  type TaskPageDto,
  type TaskRow,
  type UncompleteTaskInput,
  type UpdateTaskInput,
} from './task.dto';

interface ResolvedSettings {
  defaultListId: string | null;
  defaultReminderTime: string;
  timezone: string;
}

interface CursorValue {
  k: string;
  id: string;
}

type OrderKind = 'rank' | 'completed' | 'deleted' | 'updated';

@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ChangeLogService) private readonly changeLog: ChangeLogService,
    @Inject(ReminderService) private readonly reminders: ReminderService,
  ) {}

  async list(userId: string, query: ListTasksQuery): Promise<TaskPageDto> {
    const settings = await this.loadSettings(this.database.db, userId);
    const conditions: Array<SQL | undefined> = [eq(tasks.userId, userId)];
    const orderKind = this.orderKind(query);
    const now = new Date();

    switch (query.view) {
      case 'today': {
        const date = DateTime.now().setZone(settings.timezone).toISODate() as string;
        const bounds = localDayBounds(settings.timezone, date);
        conditions.push(isNull(tasks.deletedAt));
        conditions.push(
          or(
            and(
              isNotNull(tasks.completedAt),
              gte(tasks.completedAt, bounds.start),
              lt(tasks.completedAt, bounds.end),
            ),
            and(
              isNull(tasks.completedAt),
              or(
                eq(tasks.dueDate, date),
                and(
                  isNotNull(tasks.dueAt),
                  gte(tasks.dueAt, bounds.start),
                  lt(tasks.dueAt, bounds.end),
                ),
                and(isNotNull(tasks.dueDate), lt(tasks.dueDate, date)),
                and(isNotNull(tasks.dueAt), lt(tasks.dueAt, bounds.start)),
              ),
            ),
          ) as SQL,
        );
        break;
      }
      case 'upcoming': {
        const date = DateTime.now().setZone(settings.timezone).toISODate() as string;
        const tomorrow = localDayBounds(settings.timezone, nextDate(date));
        const firstDayAfterWindow = localDayBounds(
          settings.timezone,
          DateTime.fromISO(date, { zone: 'utc' }).plus({ days: 8 }).toISODate() as string,
        );
        const lastDayInWindow = DateTime.fromISO(date, { zone: 'utc' })
          .plus({ days: 7 })
          .toISODate() as string;
        conditions.push(isNull(tasks.deletedAt), isNull(tasks.completedAt));
        conditions.push(
          or(
            and(
              isNotNull(tasks.dueDate),
              gt(tasks.dueDate, date),
              lte(tasks.dueDate, lastDayInWindow),
            ),
            and(
              isNotNull(tasks.dueAt),
              gte(tasks.dueAt, tomorrow.start),
              lt(tasks.dueAt, firstDayAfterWindow.start),
            ),
          ) as SQL,
        );
        break;
      }
      case 'completed': {
        conditions.push(
          isNull(tasks.deletedAt),
          isNotNull(tasks.completedAt),
          gte(tasks.completedAt, addDays(now, -90)),
        );
        break;
      }
      case 'trash': {
        conditions.push(isNotNull(tasks.deletedAt), gte(tasks.deletedAt, addDays(now, -30)));
        break;
      }
      case 'all':
      case undefined: {
        if (!query.status) {
          conditions.push(isNull(tasks.deletedAt), isNull(tasks.completedAt));
        }
        break;
      }
    }

    if (query.status) {
      if (query.status === 'open') {
        conditions.push(isNull(tasks.deletedAt), isNull(tasks.completedAt));
      } else if (query.status === 'completed') {
        conditions.push(isNull(tasks.deletedAt), isNotNull(tasks.completedAt));
      } else {
        conditions.push(isNotNull(tasks.deletedAt));
      }
    }

    if (query.listId) {
      conditions.push(eq(tasks.listId, query.listId));
    }
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(or(ilike(tasks.title, pattern), ilike(tasks.notes, pattern)) as SQL);
    }
    if (query.dueFrom || query.dueTo) {
      const from = query.dueFrom;
      const to = query.dueTo;
      conditions.push(
        or(
          and(
            isNotNull(tasks.dueDate),
            from ? gte(tasks.dueDate, from) : undefined,
            to ? lte(tasks.dueDate, to) : undefined,
          ),
          and(
            isNotNull(tasks.dueAt),
            from ? sql`(${tasks.dueAt} at time zone 'UTC')::date >= ${from}::date` : undefined,
            to ? sql`(${tasks.dueAt} at time zone 'UTC')::date <= ${to}::date` : undefined,
          ),
        ) as SQL,
      );
    }

    if (query.cursor) {
      conditions.push(this.cursorCondition(orderKind, decodeCursor(query.cursor)));
    }

    const orderBy = this.orderBy(orderKind);
    const rows = await this.database.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const tagMap = await this.tagIdsForTasks(
      userId,
      pageRows.map((row) => row.id),
    );
    const items = pageRows.map((row) => toTaskDto(row, tagMap.get(row.id) ?? []));
    const last = pageRows[pageRows.length - 1];
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ k: cursorKey(orderKind, last), id: last.id }) : null,
    };
  }

  async get(userId: string, taskId: string): Promise<TaskDto> {
    const row = await this.loadTask(userId, taskId, true);
    const tagMap = await this.tagIdsForTasks(userId, [taskId]);
    return toTaskDto(row, tagMap.get(taskId) ?? []);
  }

  async getInTx(tx: Transaction, userId: string, taskId: string): Promise<TaskDto> {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);
    if (!row) {
      throw notFound('任务不存在');
    }
    return toTaskDto(row, await this.tagIdsForTask(tx, userId, taskId));
  }

  async create(userId: string, deviceId: string, input: CreateTaskInput): Promise<TaskDto> {
    return this.database.db.transaction((tx) => this.createInTx(tx, userId, deviceId, input));
  }

  async createInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    input: CreateTaskInput,
  ): Promise<TaskDto> {
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, input.id), eq(tasks.userId, userId)))
        .limit(1);
      if (existing) {
        if (existing.deletedAt) {
          throw badRequest('任务 ID 已被使用');
        }
        return toTaskDto(existing, await this.tagIdsForTask(tx, userId, existing.id));
      }
    }

    const settings = await this.loadSettings(tx, userId);
    const parent = input.parentId ? await this.loadTaskForUpdate(tx, userId, input.parentId) : null;
    if (parent) {
      if (parent.deletedAt) {
        throw badRequest('父任务已删除');
      }
      if (parent.parentId) {
        throw badRequest('子任务不能作为父任务');
      }
    }

    const listId =
      input.listId ??
      parent?.listId ??
      settings.defaultListId ??
      (await this.findInbox(tx, userId));
    if (parent && parent.listId !== listId) {
      throw badRequest('父任务与子任务必须在同一清单');
    }
    await this.assertList(tx, userId, listId);

    const due = normalizeDue(input.dueDate ?? null, input.dueAt ?? null);
    const reminderSpec = input.reminderSpec ?? [];
    if (reminderSpec.length > 0 && !due.dueDate && !due.dueAt) {
      throw badRequest('提醒需要到期日期或时间');
    }
    const recurrence = input.recurrence ? this.parseRecurrence(input.recurrence) : null;
    if (recurrence && !due.dueDate && !due.dueAt) {
      throw badRequest('重复任务需要到期日期或时间');
    }

    const tagIds = input.tagIds ?? [];
    await this.assertTags(tx, userId, tagIds);

    const id = input.id ?? newId();
    const [created] = await tx
      .insert(tasks)
      .values({
        id,
        userId,
        listId,
        parentId: input.parentId ?? null,
        title: input.title,
        notes: input.notes ?? '',
        priority: input.priority ?? 0,
        dueDate: due.dueDate,
        dueAt: due.dueAt,
        reminderSpec,
        recurrenceRule: recurrence?.rule.canonical ?? null,
        recurrenceDtstart: recurrence?.dtstart ?? null,
        recurrenceUntil: recurrence?.until ?? null,
        recurrenceCountRemaining: recurrence?.countRemaining ?? null,
        recurrenceSeq: recurrence?.seq ?? 0,
        recurrenceTimezone: recurrence?.timezone ?? null,
        sortRank: input.sortRank ?? newTaskSortRank(),
      })
      .returning();
    if (!created) {
      throw new Error('Failed to create task');
    }
    if (tagIds.length > 0) {
      await tx.insert(taskTags).values(tagIds.map((tagId) => ({ userId, taskId: id, tagId })));
    }

    const dto = toTaskDto(created, tagIds);
    await this.changeLog.append(tx, {
      userId,
      entity: 'task',
      entityId: id,
      version: created.version,
      op: 'upsert',
      changedFields: dto as unknown as Record<string, unknown>,
      deviceId,
    });
    await this.reminders.rebuildForTask(tx, id, userId);
    return dto;
  }

  async update(
    userId: string,
    deviceId: string,
    taskId: string,
    input: UpdateTaskInput,
    ifMatch?: number,
  ): Promise<TaskDto> {
    return this.database.db.transaction((tx) =>
      this.updateInTx(tx, userId, deviceId, taskId, input, ifMatch),
    );
  }

  async updateInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    taskId: string,
    input: UpdateTaskInput,
    ifMatch?: number,
  ): Promise<TaskDto> {
    const current = await this.loadTaskForUpdate(tx, userId, taskId);
    if (current.deletedAt) {
      throw deleted('任务已删除');
    }
    if (ifMatch !== undefined && ifMatch !== current.version) {
      throw preconditionFailed('任务版本已变化', { currentVersion: current.version });
    }

    let nextListId = current.listId;
    if (input.listId !== undefined && input.listId !== current.listId) {
      await this.assertList(tx, userId, input.listId);
      nextListId = input.listId;
    }

    const due = resolveDue(current, input);
    const nextReminderSpec = input.reminderSpec ?? current.reminderSpec;
    if (nextReminderSpec.length > 0 && !due.dueDate && !due.dueAt) {
      throw badRequest('提醒需要到期日期或时间');
    }

    let nextRecurrence: ParsedTaskRecurrence | null =
      current.recurrenceRule && current.recurrenceDtstart && current.recurrenceTimezone
        ? {
            rule: safeParseRule(current.recurrenceRule),
            dtstart: current.recurrenceDtstart,
            until: current.recurrenceUntil,
            countRemaining: current.recurrenceCountRemaining,
            seq: current.recurrenceSeq,
            timezone: current.recurrenceTimezone,
          }
        : null;

    if (input.recurrence !== undefined) {
      nextRecurrence = input.recurrence ? this.parseRecurrence(input.recurrence) : null;
    }
    if (nextRecurrence && !due.dueDate && !due.dueAt) {
      throw badRequest('重复任务需要到期日期或时间');
    }

    if (input.completedAt !== undefined) {
      if (input.completedAt !== null && nextRecurrence) {
        throw badRequest('重复任务请使用 complete 接口');
      }
      if (input.completedAt !== null && !isDateString(input.completedAt.slice(0, 10))) {
        throw badRequest('completedAt 不是有效时间');
      }
    }

    let nextParentId = current.parentId;
    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        nextParentId = null;
      } else {
        if (input.parentId === taskId) {
          throw badRequest('任务不能作为自己的父任务');
        }
        const parent = await this.loadTaskForUpdate(tx, userId, input.parentId);
        if (parent.deletedAt) {
          throw badRequest('父任务已删除');
        }
        if (parent.parentId) {
          throw badRequest('子任务不能作为父任务');
        }
        if (parent.listId !== nextListId) {
          throw badRequest('父任务与子任务必须在同一清单');
        }
        const children = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.parentId, taskId), isNull(tasks.deletedAt)))
          .limit(1);
        if (current.parentId === null && children.length > 0) {
          throw badRequest('有子任务的任务不能成为子任务');
        }
        nextParentId = input.parentId;
      }
    }

    if (nextParentId && nextListId !== current.listId) {
      const parent = await this.loadTaskForUpdate(tx, userId, nextParentId);
      if (parent.listId !== nextListId) {
        throw badRequest('父任务与子任务必须在同一清单');
      }
    }

    const currentTagIds = await this.tagIdsForTask(tx, userId, taskId);
    const tagIds = input.tagIds ?? currentTagIds;
    let tagsChanged = false;
    if (input.tagIds) {
      await this.assertTags(tx, userId, tagIds);
      tagsChanged =
        JSON.stringify([...tagIds].sort()) !== JSON.stringify([...currentTagIds].sort());
    }

    const patch: Partial<typeof tasks.$inferInsert> = {};
    const changed: Record<string, unknown> = {};
    if (input.title !== undefined && input.title !== current.title) {
      patch.title = input.title;
      changed.title = input.title;
    }
    if (input.notes !== undefined && input.notes !== current.notes) {
      patch.notes = input.notes;
      changed.notes = input.notes;
    }
    if (input.priority !== undefined && input.priority !== current.priority) {
      patch.priority = input.priority;
      changed.priority = input.priority;
    }
    if (nextListId !== current.listId) {
      patch.listId = nextListId;
      changed.listId = nextListId;
    }
    if (nextParentId !== current.parentId) {
      patch.parentId = nextParentId;
      changed.parentId = nextParentId;
    }
    if (due.dueDate !== current.dueDate) {
      patch.dueDate = due.dueDate;
      changed.dueDate = due.dueDate;
    }
    if ((due.dueAt?.getTime() ?? null) !== (current.dueAt?.getTime() ?? null)) {
      patch.dueAt = due.dueAt;
      changed.dueAt = due.dueAt ? due.dueAt.toISOString() : null;
    }
    if (JSON.stringify(nextReminderSpec) !== JSON.stringify(current.reminderSpec)) {
      patch.reminderSpec = nextReminderSpec;
      changed.reminderSpec = nextReminderSpec;
    }
    if (input.sortRank !== undefined && input.sortRank !== current.sortRank) {
      patch.sortRank = input.sortRank;
      changed.sortRank = input.sortRank;
    }
    this.applyRecurrencePatch(current, nextRecurrence, patch, changed);
    if (input.completedAt !== undefined) {
      const nextCompletedAt = input.completedAt === null ? null : new Date(input.completedAt);
      if ((nextCompletedAt?.getTime() ?? null) !== (current.completedAt?.getTime() ?? null)) {
        patch.completedAt = nextCompletedAt;
        changed.completedAt = nextCompletedAt ? nextCompletedAt.toISOString() : null;
      }
    }

    if (tagsChanged) {
      await tx
        .delete(taskTags)
        .where(and(eq(taskTags.taskId, taskId), eq(taskTags.userId, userId)));
      if (tagIds.length > 0) {
        await tx.insert(taskTags).values(tagIds.map((tagId) => ({ userId, taskId, tagId })));
      }
      changed.tagIds = tagIds;
    }

    if (Object.keys(patch).length === 0 && !tagsChanged) {
      return toTaskDto(current, currentTagIds);
    }

    const [updated] = await tx
      .update(tasks)
      .set({ ...patch, version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId))
      .returning();
    if (!updated) {
      throw notFound('任务不存在');
    }

    if (nextListId !== current.listId) {
      const children = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.parentId, taskId), isNull(tasks.deletedAt)));
      for (const child of children) {
        const [childRow] = await tx
          .update(tasks)
          .set({ listId: nextListId, version: sql`${tasks.version} + 1` })
          .where(eq(tasks.id, child.id))
          .returning({ version: tasks.version });
        if (childRow) {
          await this.changeLog.append(tx, {
            userId,
            entity: 'task',
            entityId: child.id,
            version: childRow.version,
            op: 'upsert',
            changedFields: { listId: nextListId },
            deviceId,
          });
        }
      }
    }

    await this.changeLog.append(tx, {
      userId,
      entity: 'task',
      entityId: taskId,
      version: updated.version,
      op: 'upsert',
      changedFields: changed,
      deviceId,
    });
    await this.reminders.rebuildForTask(tx, taskId, userId);
    return toTaskDto(updated, tagIds);
  }

  async remove(userId: string, deviceId: string, taskId: string): Promise<void> {
    await this.database.db.transaction((tx) => this.removeInTx(tx, userId, deviceId, taskId));
  }

  async removeInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    taskId: string,
  ): Promise<void> {
    const current = await this.loadTaskForUpdate(tx, userId, taskId);
    if (current.deletedAt) {
      return;
    }
    const children = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.parentId, taskId), isNull(tasks.deletedAt)));
    const now = new Date();
    const ids = [taskId, ...children.map((child) => child.id)];

    for (const id of ids) {
      const [row] = await tx
        .update(tasks)
        .set({ deletedAt: now, version: sql`${tasks.version} + 1` })
        .where(eq(tasks.id, id))
        .returning({ version: tasks.version });
      if (row) {
        await this.changeLog.append(tx, {
          userId,
          entity: 'task',
          entityId: id,
          version: row.version,
          op: 'delete',
          changedFields: { deletedAt: now.toISOString() },
          deviceId,
        });
      }
    }
    await tx
      .update(reminders)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(reminders.userId, userId),
          inArray(reminders.taskId, ids),
          inArray(reminders.status, ['pending', 'processing']),
        ),
      );
  }

  async restore(userId: string, deviceId: string, taskId: string): Promise<TaskDto> {
    return this.database.db.transaction((tx) => this.restoreInTx(tx, userId, deviceId, taskId));
  }

  async restoreInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    taskId: string,
  ): Promise<TaskDto> {
    const current = await this.loadTaskForUpdate(tx, userId, taskId);
    if (!current.deletedAt) {
      return toTaskDto(current, await this.tagIdsForTask(tx, userId, taskId));
    }
    const [list] = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, current.listId), eq(lists.userId, userId), isNull(lists.deletedAt)))
      .limit(1);
    if (!list) {
      throw versionConflict('所属清单已删除，无法恢复任务', { listId: current.listId });
    }
    if (current.parentId) {
      const parent = await this.loadTaskForUpdate(tx, userId, current.parentId);
      if (parent.deletedAt) {
        throw versionConflict('父任务仍在回收站，无法恢复', { parentId: parent.id });
      }
    }

    const children = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.parentId, taskId), isNotNull(tasks.deletedAt)));
    const ids = [taskId, ...children.map((child) => child.id)];
    for (const id of ids) {
      const [row] = await tx
        .update(tasks)
        .set({ deletedAt: null, version: sql`${tasks.version} + 1` })
        .where(eq(tasks.id, id))
        .returning({ version: tasks.version });
      if (row) {
        await this.changeLog.append(tx, {
          userId,
          entity: 'task',
          entityId: id,
          version: row.version,
          op: 'upsert',
          changedFields: { deletedAt: null },
          deviceId,
        });
        await this.reminders.rebuildForTask(tx, id, userId);
      }
    }
    const restored = await this.loadTaskForUpdate(tx, userId, taskId);
    return toTaskDto(restored, await this.tagIdsForTask(tx, userId, taskId));
  }

  async complete(
    userId: string,
    deviceId: string,
    taskId: string,
    input: CompleteTaskInput,
  ): Promise<CompleteTaskResponseDto> {
    try {
      return await this.database.db.transaction((tx) =>
        this.completeInTx(tx, userId, deviceId, taskId, input),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const task = await this.get(userId, taskId);
        return { task, status: 'already_completed', completionId: input.completionId };
      }
      throw error;
    }
  }

  async completeInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    taskId: string,
    input: CompleteTaskInput,
  ): Promise<CompleteTaskResponseDto> {
    const current = await this.loadTaskForUpdate(tx, userId, taskId);
    if (current.deletedAt) {
      throw deleted('任务已删除');
    }
    const tagIds = await this.tagIdsForTask(tx, userId, taskId);
    if (current.completedAt) {
      return {
        task: toTaskDto(current, tagIds),
        status: 'already_completed',
        completionId: input.completionId,
      };
    }
    const now = new Date();

    if (!current.recurrenceRule) {
      await tx.insert(taskCompletions).values({
        id: input.completionId,
        userId,
        taskId,
        occurrenceKey: `once:${input.completionId}`,
        occurrenceDueAt: current.dueAt,
        occurrenceDueDate: current.dueDate,
        completedAt: now,
        deviceId,
        previousDueAt: current.dueAt,
        previousDueDate: current.dueDate,
        previousCountRemaining: current.recurrenceCountRemaining,
        previousSeq: current.recurrenceSeq,
        previousLastCompletedAt: current.lastCompletedAt,
      });
      const [updated] = await tx
        .update(tasks)
        .set({ completedAt: now, version: sql`${tasks.version} + 1` })
        .where(eq(tasks.id, taskId))
        .returning();
      if (!updated) {
        throw notFound('任务不存在');
      }
      await this.changeLog.append(tx, {
        userId,
        entity: 'task',
        entityId: taskId,
        version: updated.version,
        op: 'upsert',
        changedFields: { completedAt: now.toISOString() },
        deviceId,
      });
      await this.reminders.rebuildForTask(tx, taskId, userId);
      return {
        task: toTaskDto(updated, tagIds),
        status: 'completed',
        completionId: input.completionId,
      };
    }

    const currentKey = currentOccurrenceKey(current);
    if (!currentKey) {
      throw badRequest('重复任务缺少当前实例');
    }
    if (!input.occurrenceKey) {
      throw badRequest('重复任务完成需要 occurrenceKey');
    }
    const [existing] = await tx
      .select()
      .from(taskCompletions)
      .where(
        and(
          eq(taskCompletions.taskId, taskId),
          eq(taskCompletions.occurrenceKey, input.occurrenceKey),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        task: toTaskDto(current, tagIds),
        status: 'already_completed',
        completionId: input.completionId,
      };
    }
    if (input.occurrenceKey !== currentKey) {
      throw versionConflict('occurrenceKey 与当前实例不一致', {
        currentOccurrenceKey: currentKey,
      });
    }

    const next = this.completeRecurring(current, now);
    await tx.insert(taskCompletions).values({
      id: input.completionId,
      userId,
      taskId,
      occurrenceKey: currentKey,
      occurrenceDueAt: current.dueAt,
      occurrenceDueDate: current.dueDate,
      completedAt: now,
      deviceId,
      previousDueAt: current.dueAt,
      previousDueDate: current.dueDate,
      previousCountRemaining: current.recurrenceCountRemaining,
      previousSeq: current.recurrenceSeq,
      previousLastCompletedAt: current.lastCompletedAt,
    });
    const [updated] = await tx
      .update(tasks)
      .set({
        dueDate: next.dueDate,
        dueAt: next.dueAt,
        completedAt: next.completedAt,
        lastCompletedAt: now,
        recurrenceSeq: next.seq,
        recurrenceCountRemaining: next.countRemaining,
        version: sql`${tasks.version} + 1`,
      })
      .where(eq(tasks.id, taskId))
      .returning();
    if (!updated) {
      throw notFound('任务不存在');
    }
    await this.changeLog.append(tx, {
      userId,
      entity: 'task',
      entityId: taskId,
      version: updated.version,
      op: 'upsert',
      changedFields: {
        dueDate: next.dueDate,
        dueAt: next.dueAt ? next.dueAt.toISOString() : null,
        completedAt: next.completedAt ? next.completedAt.toISOString() : null,
        lastCompletedAt: now.toISOString(),
        recurrenceSeq: next.seq,
        recurrenceCountRemaining: next.countRemaining,
      },
      deviceId,
    });
    await this.reminders.rebuildForTask(tx, taskId, userId);
    return {
      task: toTaskDto(updated, tagIds),
      status: 'completed',
      completionId: input.completionId,
    };
  }

  async uncomplete(
    userId: string,
    deviceId: string,
    taskId: string,
    input: UncompleteTaskInput,
  ): Promise<TaskDto> {
    return this.database.db.transaction((tx) =>
      this.uncompleteInTx(tx, userId, deviceId, taskId, input),
    );
  }

  async uncompleteInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    taskId: string,
    input: UncompleteTaskInput,
  ): Promise<TaskDto> {
    const current = await this.loadTaskForUpdate(tx, userId, taskId);
    if (current.deletedAt) {
      throw deleted('任务已删除');
    }
    const [ledger] = await tx
      .select()
      .from(taskCompletions)
      .where(
        and(
          eq(taskCompletions.id, input.completionId),
          eq(taskCompletions.taskId, taskId),
          eq(taskCompletions.userId, userId),
        ),
      )
      .limit(1);
    if (!ledger) {
      if (!current.recurrenceRule && !current.completedAt) {
        return toTaskDto(current, await this.tagIdsForTask(tx, userId, taskId));
      }
      throw versionConflict('完成记录不存在或已被后续完成覆盖', {
        completionId: input.completionId,
      });
    }
    const [latest] = await tx
      .select({ id: taskCompletions.id })
      .from(taskCompletions)
      .where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.userId, userId)))
      .orderBy(desc(taskCompletions.completedAt))
      .limit(1);
    if (latest && latest.id !== ledger.id) {
      throw versionConflict('只能撤销最近一次完成', { completionId: input.completionId });
    }

    await tx.delete(taskCompletions).where(eq(taskCompletions.id, ledger.id));
    const [updated] = await tx
      .update(tasks)
      .set({
        dueDate: ledger.previousDueDate,
        dueAt: ledger.previousDueAt,
        completedAt: null,
        lastCompletedAt: ledger.previousLastCompletedAt,
        recurrenceSeq: ledger.previousSeq ?? current.recurrenceSeq,
        recurrenceCountRemaining: ledger.previousCountRemaining ?? current.recurrenceCountRemaining,
        version: sql`${tasks.version} + 1`,
      })
      .where(eq(tasks.id, taskId))
      .returning();
    if (!updated) {
      throw notFound('任务不存在');
    }
    await this.changeLog.append(tx, {
      userId,
      entity: 'task',
      entityId: taskId,
      version: updated.version,
      op: 'upsert',
      changedFields: {
        dueDate: updated.dueDate,
        dueAt: updated.dueAt ? updated.dueAt.toISOString() : null,
        completedAt: null,
        lastCompletedAt: updated.lastCompletedAt ? updated.lastCompletedAt.toISOString() : null,
        recurrenceSeq: updated.recurrenceSeq,
        recurrenceCountRemaining: updated.recurrenceCountRemaining,
      },
      deviceId,
    });
    await this.reminders.rebuildForTask(tx, taskId, userId);
    return toTaskDto(updated, await this.tagIdsForTask(tx, userId, taskId));
  }

  async batch(
    userId: string,
    deviceId: string,
    input: BatchTaskInput,
  ): Promise<BatchTaskResponseDto> {
    const results: BatchTaskResponseDto['results'] = [];
    for (const taskId of input.taskIds) {
      try {
        if (input.action === 'delete') {
          await this.remove(userId, deviceId, taskId);
          results.push({ taskId, status: 'applied' });
        } else if (input.action === 'move') {
          const task = await this.update(
            userId,
            deviceId,
            taskId,
            { listId: input.targetListId as string },
            undefined,
          );
          results.push({ taskId, status: 'applied', task });
        } else {
          const row = await this.loadTask(userId, taskId, false);
          const occurrenceKey = currentOccurrenceKey(row);
          const task = await this.complete(userId, deviceId, taskId, {
            occurrenceKey: occurrenceKey ?? undefined,
            completionId: newId(),
          });
          results.push({ taskId, status: 'applied', task: task.task });
        }
      } catch (error) {
        const isConflict =
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          (error as { status?: number }).status === 409;
        results.push({
          taskId,
          status: isConflict ? 'conflict' : 'rejected',
          error: toBatchError(error),
        });
      }
    }
    return { results };
  }

  async reorder(userId: string, deviceId: string, input: ReorderTasksInput): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const ids = input.items.map((item) => item.taskId);
      const rows = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids), isNull(tasks.deletedAt)));
      if (rows.length !== ids.length) {
        throw notFound('部分任务不存在');
      }
      for (const item of input.items) {
        const [updated] = await tx
          .update(tasks)
          .set({ sortRank: item.sortRank, version: sql`${tasks.version} + 1` })
          .where(eq(tasks.id, item.taskId))
          .returning({ version: tasks.version });
        if (updated) {
          await this.changeLog.append(tx, {
            userId,
            entity: 'task',
            entityId: item.taskId,
            version: updated.version,
            op: 'upsert',
            changedFields: { sortRank: item.sortRank },
            deviceId,
          });
        }
      }
    });
  }

  private completeRecurring(
    current: TaskRow,
    now: Date,
  ): {
    dueDate: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
    seq: number;
    countRemaining: number | null;
  } {
    const rule = safeParseRule(current.recurrenceRule as string);
    const timezone = current.recurrenceTimezone as string;
    let remaining = current.recurrenceCountRemaining;
    let seq = current.recurrenceSeq;
    let dueDate = current.dueDate;
    let dueAt = current.dueAt;

    if (remaining !== null) {
      remaining -= 1;
      if (remaining <= 0) {
        return {
          dueDate,
          dueAt,
          completedAt: now,
          seq: seq + 1,
          countRemaining: 0,
        };
      }
    }

    let occurrence = nextRecurrence({
      rule,
      timezone,
      dtstart: current.recurrenceDtstart as Date,
      dueDate,
      dueAt,
    });
    let guard = 0;
    while (this.isOccurrencePast(occurrence, timezone, now)) {
      if (current.recurrenceUntil && occurrence.localDate > current.recurrenceUntil) {
        return { dueDate, dueAt, completedAt: now, seq: seq + 1, countRemaining: remaining };
      }
      if (remaining !== null) {
        remaining -= 1;
        if (remaining <= 0) {
          return {
            dueDate,
            dueAt,
            completedAt: now,
            seq: seq + 1,
            countRemaining: 0,
          };
        }
      }
      seq += 1;
      if (guard++ > 1000) {
        throw badRequest('重复任务推进次数过多');
      }
      occurrence = nextRecurrence({
        rule,
        timezone,
        dtstart: current.recurrenceDtstart as Date,
        dueDate: occurrence.dueDate,
        dueAt: occurrence.dueAt,
      });
    }

    if (current.recurrenceUntil && occurrence.localDate > current.recurrenceUntil) {
      return { dueDate, dueAt, completedAt: now, seq: seq + 1, countRemaining: remaining };
    }
    seq += 1;
    dueDate = occurrence.dueDate;
    dueAt = occurrence.dueAt;
    return { dueDate, dueAt, completedAt: null, seq, countRemaining: remaining };
  }

  private isOccurrencePast(
    occurrence: { dueDate: string | null; dueAt: Date | null; localDate: string },
    timezone: string,
    now: Date,
  ): boolean {
    if (occurrence.dueAt) {
      return occurrence.dueAt.getTime() <= now.getTime();
    }
    return occurrence.localDate < (localDateOf(now, timezone) as string);
  }

  private async loadTask(userId: string, taskId: string, allowDeleted: boolean): Promise<TaskRow> {
    const [row] = await this.database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);
    if (!row || (!allowDeleted && row.deletedAt)) {
      throw notFound('任务不存在');
    }
    return row;
  }

  private async loadTaskForUpdate(
    tx: Transaction,
    userId: string,
    taskId: string,
  ): Promise<TaskRow> {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .for('update')
      .limit(1);
    if (!row) {
      throw notFound('任务不存在');
    }
    return row;
  }

  private async loadSettings(
    executor: DatabaseService['db'] | Transaction,
    userId: string,
  ): Promise<ResolvedSettings> {
    const [row] = await executor
      .select({
        defaultListId: userSettings.defaultListId,
        defaultReminderTime: userSettings.defaultReminderTime,
        timezone: users.timezone,
      })
      .from(userSettings)
      .innerJoin(users, eq(users.id, userSettings.userId))
      .where(eq(userSettings.userId, userId))
      .limit(1);
    return {
      defaultListId: row?.defaultListId ?? null,
      defaultReminderTime: row?.defaultReminderTime ?? '09:00',
      timezone: row?.timezone ?? 'UTC',
    };
  }

  private async findInbox(
    executor: DatabaseService['db'] | Transaction,
    userId: string,
  ): Promise<string> {
    const [row] = await executor
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.userId, userId), eq(lists.isDefault, true), isNull(lists.deletedAt)))
      .limit(1);
    if (!row) {
      throw new Error('Default inbox is missing');
    }
    return row.id;
  }

  private async assertList(tx: Transaction, userId: string, listId: string): Promise<void> {
    const [row] = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId), isNull(lists.deletedAt)))
      .limit(1);
    if (!row) {
      throw badRequest('清单不存在', { listId });
    }
  }

  private async assertTags(tx: Transaction, userId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) {
      return;
    }
    const rows = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, tagIds), isNull(tags.deletedAt)));
    if (rows.length !== new Set(tagIds).size) {
      throw badRequest('标签不存在');
    }
  }

  private parseRecurrence(input: {
    rule: string;
    timezone: string;
    dtstart: string;
    until?: string | null;
    countRemaining?: number | null;
    seq: number;
  }): ParsedTaskRecurrence {
    try {
      const rule = parseRecurrenceRule(input.rule);
      if (!isValidTimezone(input.timezone)) {
        throw new RecurrenceRuleError(`Invalid recurrence timezone: ${input.timezone}`);
      }
      const dtstart = new Date(input.dtstart);
      if (Number.isNaN(dtstart.getTime())) {
        throw new RecurrenceRuleError('Invalid recurrence dtstart');
      }
      if (input.until && !isDateString(input.until)) {
        throw new RecurrenceRuleError('Invalid recurrence until');
      }
      return {
        rule,
        timezone: input.timezone,
        dtstart,
        until: input.until ?? null,
        countRemaining: input.countRemaining ?? null,
        seq: input.seq,
      };
    } catch (error) {
      if (error instanceof RecurrenceRuleError) {
        throw badRequest(error.message);
      }
      throw error;
    }
  }

  private applyRecurrencePatch(
    current: TaskRow,
    next: ParsedTaskRecurrence | null,
    patch: Partial<typeof tasks.$inferInsert>,
    changed: Record<string, unknown>,
  ): void {
    if (!next) {
      if (current.recurrenceRule) {
        patch.recurrenceRule = null;
        patch.recurrenceDtstart = null;
        patch.recurrenceUntil = null;
        patch.recurrenceCountRemaining = null;
        patch.recurrenceSeq = 0;
        patch.recurrenceTimezone = null;
        changed.recurrence = null;
      }
      return;
    }
    const nextRule = next.rule.canonical;
    if (
      nextRule !== current.recurrenceRule ||
      next.dtstart.getTime() !== (current.recurrenceDtstart?.getTime() ?? null) ||
      next.until !== current.recurrenceUntil ||
      next.countRemaining !== current.recurrenceCountRemaining ||
      next.seq !== current.recurrenceSeq ||
      next.timezone !== current.recurrenceTimezone
    ) {
      patch.recurrenceRule = nextRule;
      patch.recurrenceDtstart = next.dtstart;
      patch.recurrenceUntil = next.until;
      patch.recurrenceCountRemaining = next.countRemaining;
      patch.recurrenceSeq = next.seq;
      patch.recurrenceTimezone = next.timezone;
      changed.recurrence = {
        rule: nextRule,
        timezone: next.timezone,
        dtstart: next.dtstart.toISOString(),
        until: next.until,
        countRemaining: next.countRemaining,
        seq: next.seq,
      };
    }
  }

  private async tagIdsForTask(
    executor: Transaction,
    userId: string,
    taskId: string,
  ): Promise<string[]> {
    const rows = await executor
      .select({ tagId: taskTags.tagId })
      .from(taskTags)
      .where(and(eq(taskTags.userId, userId), eq(taskTags.taskId, taskId)));
    return rows.map((row) => row.tagId);
  }

  private async tagIdsForTasks(userId: string, taskIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (taskIds.length === 0) {
      return map;
    }
    const rows = await this.database.db
      .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
      .from(taskTags)
      .where(and(eq(taskTags.userId, userId), inArray(taskTags.taskId, taskIds)));
    for (const row of rows) {
      const list = map.get(row.taskId) ?? [];
      list.push(row.tagId);
      map.set(row.taskId, list);
    }
    return map;
  }

  private orderKind(query: ListTasksQuery): OrderKind {
    if (query.view === 'completed') return 'completed';
    if (query.view === 'trash') return 'deleted';
    if (query.q) return 'updated';
    return 'rank';
  }

  private orderBy(kind: OrderKind): SQL[] {
    switch (kind) {
      case 'completed':
        return [desc(tasks.completedAt), desc(tasks.id)];
      case 'deleted':
        return [desc(tasks.deletedAt), desc(tasks.id)];
      case 'updated':
        return [desc(tasks.updatedAt), desc(tasks.id)];
      case 'rank':
        return [asc(tasks.sortRank), asc(tasks.id)];
    }
  }

  private cursorCondition(kind: OrderKind, cursor: CursorValue): SQL {
    switch (kind) {
      case 'completed': {
        const value = new Date(cursor.k);
        return or(
          lt(tasks.completedAt, value),
          and(eq(tasks.completedAt, value), lt(tasks.id, cursor.id)),
        ) as SQL;
      }
      case 'deleted': {
        const value = new Date(cursor.k);
        return or(
          lt(tasks.deletedAt, value),
          and(eq(tasks.deletedAt, value), lt(tasks.id, cursor.id)),
        ) as SQL;
      }
      case 'updated': {
        const value = new Date(cursor.k);
        return or(
          lt(tasks.updatedAt, value),
          and(eq(tasks.updatedAt, value), lt(tasks.id, cursor.id)),
        ) as SQL;
      }
      case 'rank':
        return or(
          gt(tasks.sortRank, cursor.k),
          and(eq(tasks.sortRank, cursor.k), gt(tasks.id, cursor.id)),
        ) as SQL;
    }
  }
}

interface ParsedTaskRecurrence {
  rule: ParsedRecurrenceRule;
  timezone: string;
  dtstart: Date;
  until: string | null;
  countRemaining: number | null;
  seq: number;
}

function normalizeDue(
  dueDate: string | null,
  dueAt: string | null,
): { dueDate: string | null; dueAt: Date | null } {
  if (dueDate && dueAt) {
    throw badRequest('dueDate 与 dueAt 不能同时设置');
  }
  const parsedAt = dueAt ? new Date(dueAt) : null;
  if (parsedAt && Number.isNaN(parsedAt.getTime())) {
    throw badRequest('dueAt 不是有效时间');
  }
  return { dueDate: dueDate ?? null, dueAt: parsedAt };
}

function resolveDue(
  current: TaskRow,
  input: UpdateTaskInput,
): { dueDate: string | null; dueAt: Date | null } {
  let dueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate;
  let dueAt =
    input.dueAt !== undefined ? (input.dueAt ? new Date(input.dueAt) : null) : current.dueAt;
  if (input.dueDate !== undefined && dueDate !== null && input.dueAt === undefined) {
    dueAt = null;
  }
  if (input.dueAt !== undefined && dueAt !== null && input.dueDate === undefined) {
    dueDate = null;
  }
  if (dueDate && dueAt) {
    throw badRequest('dueDate 与 dueAt 不能同时设置');
  }
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    throw badRequest('dueAt 不是有效时间');
  }
  return { dueDate: dueDate ?? null, dueAt };
}

function safeParseRule(rule: string): ParsedRecurrenceRule {
  try {
    return parseRecurrenceRule(rule);
  } catch (error) {
    if (error instanceof RecurrenceRuleError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function cursorKey(kind: OrderKind, row: TaskRow): string {
  switch (kind) {
    case 'completed':
      return (row.completedAt as Date).toISOString();
    case 'deleted':
      return (row.deletedAt as Date).toISOString();
    case 'updated':
      return row.updatedAt.toISOString();
    case 'rank':
      return row.sortRank;
  }
}

function encodeCursor(cursor: CursorValue): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): CursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CursorValue).k !== 'string' ||
      typeof (parsed as CursorValue).id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        (parsed as CursorValue).id,
      )
    ) {
      throw new Error('invalid cursor');
    }
    return parsed as CursorValue;
  } catch {
    throw badRequest('无效的分页游标');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function toBatchError(error: unknown): BatchTaskResponseDto['results'][number]['error'] {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'code' in error &&
    'message' in error
  ) {
    return {
      error: {
        code: String((error as { code: unknown }).code),
        message: String((error as { message: unknown }).message),
        details:
          'details' in error
            ? ((error as { details?: Record<string, unknown> }).details ?? undefined)
            : undefined,
        requestId: 'batch',
      },
    };
  }
  return {
    error: {
      code: 'INTERNAL',
      message: '处理失败',
      requestId: 'batch',
    },
  };
}
