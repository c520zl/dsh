import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../../common/errors';
import { newId } from '../../domain/ids';
import { tags, taskTags, tasks } from '../../db/schema';
import { ChangeLogService } from '../../core/change-log.service';
import { DatabaseService, type Transaction } from '../../core/database.service';
import { toTagDto, type CreateTagInput, type TagDto, type UpdateTagInput } from './tag.dto';

@Injectable()
export class TagsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ChangeLogService) private readonly changeLog: ChangeLogService,
  ) {}

  async list(userId: string): Promise<TagDto[]> {
    const rows = await this.database.db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, userId), isNull(tags.deletedAt)))
      .orderBy(asc(tags.createdAt));
    return rows.map(toTagDto);
  }

  async create(userId: string, deviceId: string, input: CreateTagInput): Promise<TagDto> {
    return this.database.db.transaction((tx) => this.createInTx(tx, userId, deviceId, input));
  }

  async createInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    input: CreateTagInput,
  ): Promise<TagDto> {
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(tags)
        .where(and(eq(tags.id, input.id), eq(tags.userId, userId)))
        .limit(1);
      if (existing) {
        if (existing.deletedAt) {
          throw badRequest('标签 ID 已被使用');
        }
        return toTagDto(existing);
      }
    }
    await this.assertNameAvailable(tx, userId, input.name, null);
    const [created] = await tx
      .insert(tags)
      .values({
        id: input.id ?? newId(),
        userId,
        name: input.name,
        color: input.color ?? 'slate',
      })
      .returning();
    if (!created) {
      throw new Error('Failed to create tag');
    }
    await this.changeLog.append(tx, {
      userId,
      entity: 'tag',
      entityId: created.id,
      version: created.version,
      op: 'upsert',
      changedFields: toTagDto(created) as unknown as Record<string, unknown>,
      deviceId,
    });
    return toTagDto(created);
  }

  async update(
    userId: string,
    deviceId: string,
    tagId: string,
    input: UpdateTagInput,
  ): Promise<TagDto> {
    return this.database.db.transaction((tx) =>
      this.updateInTx(tx, userId, deviceId, tagId, input),
    );
  }

  async updateInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    tagId: string,
    input: UpdateTagInput,
  ): Promise<TagDto> {
    const [current] = await tx
      .select()
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId), isNull(tags.deletedAt)))
      .limit(1);
    if (!current) {
      throw notFound('标签不存在');
    }
    if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameAvailable(tx, userId, input.name, tagId);
    }
    const patch: Partial<typeof tags.$inferInsert> = {};
    const changed: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== current.name) {
      patch.name = input.name;
      changed.name = input.name;
    }
    if (input.color !== undefined && input.color !== current.color) {
      patch.color = input.color;
      changed.color = input.color;
    }
    if (Object.keys(patch).length === 0) {
      return toTagDto(current);
    }
    const [updated] = await tx
      .update(tags)
      .set({ ...patch, version: sql`${tags.version} + 1` })
      .where(eq(tags.id, tagId))
      .returning();
    if (!updated) {
      throw notFound('标签不存在');
    }
    await this.changeLog.append(tx, {
      userId,
      entity: 'tag',
      entityId: tagId,
      version: updated.version,
      op: 'upsert',
      changedFields: changed,
      deviceId,
    });
    return toTagDto(updated);
  }

  async delete(userId: string, deviceId: string, tagId: string): Promise<void> {
    await this.database.db.transaction((tx) => this.deleteInTx(tx, userId, deviceId, tagId));
  }

  async deleteInTx(
    tx: Transaction,
    userId: string,
    deviceId: string,
    tagId: string,
  ): Promise<void> {
    const [current] = await tx
      .select()
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId), isNull(tags.deletedAt)))
      .limit(1);
    if (!current) {
      throw notFound('标签不存在');
    }

    const affected = await tx
      .select({ taskId: taskTags.taskId })
      .from(taskTags)
      .where(and(eq(taskTags.userId, userId), eq(taskTags.tagId, tagId)));
    const affectedIds = affected.map((row) => row.taskId);

    await tx.delete(taskTags).where(and(eq(taskTags.userId, userId), eq(taskTags.tagId, tagId)));
    for (const taskId of affectedIds) {
      const [updated] = await tx
        .update(tasks)
        .set({ version: sql`${tasks.version} + 1` })
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning({ version: tasks.version });
      if (updated) {
        await this.changeLog.append(tx, {
          userId,
          entity: 'task',
          entityId: taskId,
          version: updated.version,
          op: 'upsert',
          changedFields: { tagIds: [] },
          deviceId,
        });
      }
    }

    const now = new Date();
    const [deletedTag] = await tx
      .update(tags)
      .set({ deletedAt: now, version: sql`${tags.version} + 1` })
      .where(eq(tags.id, tagId))
      .returning({ version: tags.version });
    if (deletedTag) {
      await this.changeLog.append(tx, {
        userId,
        entity: 'tag',
        entityId: tagId,
        version: deletedTag.version,
        op: 'delete',
        changedFields: { deletedAt: now.toISOString() },
        deviceId,
      });
    }
  }

  private async assertNameAvailable(
    tx: Transaction,
    userId: string,
    name: string,
    excludeTagId: string | null,
  ): Promise<void> {
    const rows = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          eq(tags.userId, userId),
          isNull(tags.deletedAt),
          sql`lower(${tags.name}) = lower(${name})`,
          excludeTagId ? sql`${tags.id} <> ${excludeTagId}` : undefined,
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      throw badRequest('同名标签已存在', { name });
    }
  }
}
