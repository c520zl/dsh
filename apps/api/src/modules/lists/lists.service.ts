import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../../common/errors';
import { newId } from '../../domain/ids';
import { newListSortRank } from '../../domain/sort-rank';
import { lists, reminders, tasks, userSettings } from '../../db/schema';
import { ChangeLogService } from '../../core/change-log.service';
import { DatabaseService, type Transaction } from '../../core/database.service';
import {
  toListDto,
  type CreateListInput,
  type DeleteListInput,
  type ListDto,
  type ListRow,
  type UpdateListInput,
} from './list.dto';

@Injectable()
export class ListsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ChangeLogService) private readonly changeLog: ChangeLogService,
  ) {}

  async list(userId: string, includeArchived: boolean): Promise<ListDto[]> {
    const rows = await this.database.db
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.userId, userId),
          isNull(lists.deletedAt),
          includeArchived ? undefined : eq(lists.isArchived, false),
        ),
      )
      .orderBy(asc(lists.sortRank), asc(lists.createdAt));
    return rows.map(toListDto);
  }

  async getById(userId: string, listId: string): Promise<ListRow> {
    const [row] = await this.database.db
      .select()
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId), isNull(lists.deletedAt)))
      .limit(1);
    if (!row) {
      throw notFound('清单不存在');
    }
    return row;
  }

  async create(userId: string, deviceId: string, input: CreateListInput): Promise<ListDto> {
    return this.database.db.transaction((tx) => this.createInTx(tx, userId, deviceId, input));
  }

  async createInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    input: CreateListInput,
  ): Promise<ListDto> {
    const id = input.id ?? newId();
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1);
      if (existing) {
        if (existing.deletedAt) {
          throw badRequest('清单 ID 已被使用');
        }
        return toListDto(existing);
      }
    }

    const [active] = await tx
      .select({ value: count() })
      .from(lists)
      .where(and(eq(lists.userId, userId), isNull(lists.deletedAt)));
    if (Number(active?.value ?? 0) >= 500) {
      throw badRequest('清单数量已达上限（500）');
    }
    await this.assertNameAvailable(userId, input.name, null, tx);

    let created: ListRow | undefined;
    try {
      [created] = await tx
        .insert(lists)
        .values({
          id,
          userId,
          name: input.name,
          color: input.color ?? 'coral',
          icon: input.icon ?? 'list',
          sortRank: input.sortRank ?? newListSortRank(),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw badRequest('同名清单已存在', { name: input.name });
      }
      throw error;
    }
    if (!created) {
      throw new Error('Failed to create list');
    }
    await this.changeLog.append(tx, {
      userId,
      entity: 'list',
      entityId: created.id,
      version: created.version,
      op: 'upsert',
      changedFields: toListDto(created) as unknown as Record<string, unknown>,
      deviceId,
    });
    return toListDto(created);
  }

  async update(
    userId: string,
    deviceId: string,
    listId: string,
    input: UpdateListInput,
  ): Promise<ListDto> {
    return this.database.db.transaction((tx) =>
      this.updateInTx(tx, userId, deviceId, listId, input),
    );
  }

  async updateInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    listId: string,
    input: UpdateListInput,
  ): Promise<ListDto> {
    const [current] = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId), isNull(lists.deletedAt)))
      .limit(1);
    if (!current) {
      throw notFound('清单不存在');
    }
    if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameAvailable(userId, input.name, listId, tx);
    }

    const patch: Partial<typeof lists.$inferInsert> = {};
    const changed: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== current.name) {
      patch.name = input.name;
      changed.name = input.name;
    }
    if (input.color !== undefined && input.color !== current.color) {
      patch.color = input.color;
      changed.color = input.color;
    }
    if (input.icon !== undefined && input.icon !== current.icon) {
      patch.icon = input.icon;
      changed.icon = input.icon;
    }
    if (input.sortRank !== undefined && input.sortRank !== current.sortRank) {
      patch.sortRank = input.sortRank;
      changed.sortRank = input.sortRank;
    }
    if (input.isArchived !== undefined && input.isArchived !== current.isArchived) {
      patch.isArchived = input.isArchived;
      changed.isArchived = input.isArchived;
    }
    if (Object.keys(patch).length === 0) {
      return toListDto(current);
    }

    let updated: ListRow | undefined;
    try {
      [updated] = await tx
        .update(lists)
        .set({ ...patch, version: sql`${lists.version} + 1` })
        .where(eq(lists.id, listId))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw badRequest('同名清单已存在', { name: input.name });
      }
      throw error;
    }
    if (!updated) {
      throw notFound('清单不存在');
    }
    await this.changeLog.append(tx, {
      userId,
      entity: 'list',
      entityId: updated.id,
      version: updated.version,
      op: 'upsert',
      changedFields: changed,
      deviceId,
    });
    return toListDto(updated);
  }

  async delete(
    userId: string,
    deviceId: string,
    listId: string,
    input: DeleteListInput,
  ): Promise<void> {
    await this.database.db.transaction((tx) =>
      this.deleteInTx(tx, userId, deviceId, listId, input),
    );
  }

  async deleteInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    listId: string,
    input: DeleteListInput,
  ): Promise<void> {
    const [current] = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId), isNull(lists.deletedAt)))
      .limit(1);
    if (!current) {
      throw notFound('清单不存在');
    }
    if (current.isDefault) {
      throw badRequest('收件箱不可删除');
    }

    const [inbox] = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.userId, userId), eq(lists.isDefault, true), isNull(lists.deletedAt)))
      .limit(1);
    if (!inbox) {
      throw new Error('Default inbox is missing');
    }

    const affected = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.listId, listId), isNull(tasks.deletedAt)));

    const now = new Date();
    if (input.taskAction === 'move_to_inbox') {
      for (const task of affected) {
        const [updated] = await tx
          .update(tasks)
          .set({ listId: inbox.id, version: sql`${tasks.version} + 1` })
          .where(eq(tasks.id, task.id))
          .returning({ version: tasks.version });
        if (updated) {
          await this.changeLog.append(tx, {
            userId,
            entity: 'task',
            entityId: task.id,
            version: updated.version,
            op: 'upsert',
            changedFields: { listId: inbox.id },
            deviceId,
          });
        }
      }
    } else {
      for (const task of affected) {
        const [updated] = await tx
          .update(tasks)
          .set({
            deletedAt: now,
            version: sql`${tasks.version} + 1`,
          })
          .where(eq(tasks.id, task.id))
          .returning({ version: tasks.version });
        if (updated) {
          await tx
            .update(reminders)
            .set({ status: 'canceled' })
            .where(
              and(
                eq(reminders.taskId, task.id),
                eq(reminders.userId, userId),
                inArray(reminders.status, ['pending', 'processing']),
              ),
            );
          await this.changeLog.append(tx, {
            userId,
            entity: 'task',
            entityId: task.id,
            version: updated.version,
            op: 'delete',
            changedFields: { deletedAt: now.toISOString() },
            deviceId,
          });
        }
      }
    }

    const [deletedList] = await tx
      .update(lists)
      .set({ deletedAt: now, version: sql`${lists.version} + 1` })
      .where(eq(lists.id, listId))
      .returning({ version: lists.version });
    if (deletedList) {
      await this.changeLog.append(tx, {
        userId,
        entity: 'list',
        entityId: listId,
        version: deletedList.version,
        op: 'delete',
        changedFields: { deletedAt: now.toISOString() },
        deviceId,
      });
    }

    const [settings] = await tx
      .select({ defaultListId: userSettings.defaultListId })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (settings?.defaultListId === listId) {
      await tx
        .update(userSettings)
        .set({
          defaultListId: inbox.id,
          version: sql`${userSettings.version} + 1`,
        })
        .where(eq(userSettings.userId, userId));
    }
  }

  private async assertNameAvailable(
    userId: string,
    name: string,
    excludeListId: string | null,
    tx: Transaction,
  ): Promise<void> {
    const rows = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(
        and(
          eq(lists.userId, userId),
          isNull(lists.deletedAt),
          sql`lower(${lists.name}) = lower(${name})`,
          excludeListId ? sql`${lists.id} <> ${excludeListId}` : undefined,
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      throw badRequest('同名清单已存在', { name });
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
