import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, isNull, min, sql } from 'drizzle-orm';
import { ZodError, type ZodType } from 'zod';
import { ApiError, badRequest, forbidden } from '../../common/errors';
import { lists, tags, devices, changeLog, processedOps, userSyncState } from '../../db/schema';
import { DatabaseService, type Transaction } from '../../core/database.service';
import { ReminderService } from '../../core/reminder.service';
import { ListsService } from '../lists/lists.service';
import { createListSchema, updateListSchema, type UpdateListInput } from '../lists/list.dto';
import { TagsService } from '../tags/tags.service';
import { createTagSchema, updateTagSchema, type UpdateTagInput } from '../tags/tag.dto';
import { TasksService } from '../tasks/task.service';
import { createTaskSchema, updateTaskSchema, type UpdateTaskInput } from '../tasks/task.dto';
import {
  type SyncOpInput,
  type SyncOpResultDto,
  type SyncPatch,
  type SyncPullQuery,
  type SyncPullResponseDto,
  type SyncPushInput,
  type SyncPushResponseDto,
  type SyncSnapshotResponseDto,
} from './sync.dto';

type EntityType = 'task' | 'list' | 'tag';

interface MergeResult {
  patch: Record<string, unknown>;
  conflictFields: string[];
  merged: boolean;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ReminderService) private readonly reminders: ReminderService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(ListsService) private readonly lists: ListsService,
    @Inject(TagsService) private readonly tags: TagsService,
  ) {}

  async snapshot(userId: string): Promise<SyncSnapshotResponseDto> {
    const [state] = await this.database.db
      .select({ cursor: userSyncState.currentSeq })
      .from(userSyncState)
      .where(eq(userSyncState.userId, userId))
      .limit(1);
    return { cursor: state?.cursor ?? 0 };
  }

  async pull(userId: string, query: SyncPullQuery): Promise<SyncPullResponseDto> {
    const currentCursor = await this.snapshot(userId);
    if (query.since > currentCursor.cursor) {
      return { changes: [], nextCursor: currentCursor.cursor, hasMore: false };
    }

    const [oldest] = await this.database.db
      .select({ seq: min(changeLog.seq) })
      .from(changeLog)
      .where(eq(changeLog.userId, userId));

    const rows = await this.database.db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.userId, userId), gt(changeLog.seq, query.since)))
      .orderBy(asc(changeLog.seq))
      .limit(query.limit + 1);

    if (rows.length === 0) {
      if (query.since < currentCursor.cursor) {
        throw this.cursorExpiredError(query.since, oldest?.seq ?? null, currentCursor.cursor);
      }
      return { changes: [], nextCursor: query.since, hasMore: false };
    }
    if (oldest?.seq != null && query.since + 1 < Number(oldest.seq)) {
      throw this.cursorExpiredError(query.since, Number(oldest.seq), currentCursor.cursor);
    }

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return {
      changes: page.map((row) => ({
        seq: row.seq,
        entity: row.entityType as EntityType,
        entityId: row.entityId,
        op: row.op as 'upsert' | 'delete',
        version: row.entityVersion,
        changedFields: row.changedFields,
      })),
      nextCursor: last ? last.seq : query.since,
      hasMore,
    };
  }

  async push(userId: string, input: SyncPushInput): Promise<SyncPushResponseDto> {
    const [device] = await this.database.db
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(eq(devices.id, input.deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)),
      )
      .limit(1);
    if (!device) {
      throw forbidden('设备不存在或已被移除');
    }

    const results = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select sync.lock_user(${userId}::uuid)`);
      const opResults: SyncOpResultDto[] = [];
      for (const op of input.ops) {
        const [cached] = await tx
          .select({ result: processedOps.result })
          .from(processedOps)
          .where(and(eq(processedOps.userId, userId), eq(processedOps.opId, op.opId)))
          .limit(1);
        if (cached) {
          opResults.push(cached.result as unknown as SyncOpResultDto);
          continue;
        }

        let result: SyncOpResultDto;
        try {
          result = await tx.transaction((savepoint) =>
            this.applyOp(savepoint, userId, input.deviceId, op),
          );
        } catch (error) {
          result = this.errorResult(op.opId, error);
        }
        await tx.insert(processedOps).values({
          userId,
          opId: op.opId,
          result: result as unknown as Record<string, unknown>,
        });
        opResults.push(result);
      }

      if (input.localDeliveries && input.localDeliveries.length > 0) {
        await this.reminders.processLocalDeliveries(tx, userId, input.localDeliveries);
      }
      return opResults;
    });

    return { results };
  }

  private async applyOp(
    tx: Transaction,
    userId: string,
    deviceId: string,
    op: SyncOpInput,
  ): Promise<SyncOpResultDto> {
    switch (op.entity) {
      case 'task':
        return this.applyTaskOp(tx, userId, deviceId, op);
      case 'list':
        return this.applyListOp(tx, userId, deviceId, op);
      case 'tag':
        return this.applyTagOp(tx, userId, deviceId, op);
    }
  }

  private async applyTaskOp(
    tx: Transaction,
    userId: string,
    deviceId: string,
    op: SyncOpInput,
  ): Promise<SyncOpResultDto> {
    if (op.op === 'create') {
      this.assertOnlyTaskFields(op.patch);
      const input = parse(createTaskSchema, { ...mapTaskPatch(op.patch), id: op.entityId });
      const task = await this.tasks.createInTx(tx, userId, deviceId, input);
      return { opId: op.opId, status: 'applied', version: task.version, task };
    }

    const current = await this.tasks.getInTx(tx, userId, op.entityId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    });
    if (!current) {
      return this.rejected(op.opId, 'NOT_FOUND', '任务不存在');
    }
    if (op.op !== 'delete' && current.deletedAt) {
      return this.rejected(op.opId, 'DELETED', '任务已删除');
    }

    if (op.op === 'update') {
      this.assertOnlyTaskFields(op.patch);
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      const patch = parse(updateTaskSchema, mapTaskPatch(op.patch));
      const merge =
        baseVersion < current.version
          ? await this.mergePatch(tx, userId, 'task', op.entityId, baseVersion, patch)
          : { patch, conflictFields: [], merged: false };
      if (Object.keys(merge.patch).length === 0) {
        return {
          opId: op.opId,
          status: merge.conflictFields.length > 0 ? 'conflict' : 'merged',
          version: current.version,
          task: current,
          conflictFields: merge.conflictFields,
        };
      }
      const updated = await this.tasks.updateInTx(
        tx,
        userId,
        deviceId,
        op.entityId,
        merge.patch as UpdateTaskInput,
      );
      return {
        opId: op.opId,
        status: merge.conflictFields.length > 0 ? 'conflict' : merge.merged ? 'merged' : 'applied',
        version: updated.version,
        task: updated,
        conflictFields: merge.conflictFields,
      };
    }

    if (op.op === 'delete') {
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      if (current.deletedAt) {
        return { opId: op.opId, status: 'applied', version: current.version, task: current };
      }
      await this.tasks.removeInTx(tx, userId, deviceId, op.entityId);
      return { opId: op.opId, status: 'applied', version: current.version + 1 };
    }

    if (op.op === 'complete') {
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      if (!op.completionId) {
        throw badRequest('complete 需要 completionId');
      }
      const completed = await this.tasks.completeInTx(tx, userId, deviceId, op.entityId, {
        occurrenceKey: op.occurrenceKey,
        completionId: op.completionId,
      });
      return {
        opId: op.opId,
        status: completed.status === 'already_completed' ? 'already_completed' : 'applied',
        version: completed.task.version,
        task: completed.task,
      };
    }

    const baseVersion = requireBaseVersion(op);
    if (baseVersion > current.version) {
      return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
    }
    if (!op.completionId) {
      throw badRequest('uncomplete 需要 completionId');
    }
    const task = await this.tasks.uncompleteInTx(tx, userId, deviceId, op.entityId, {
      completionId: op.completionId,
    });
    return { opId: op.opId, status: 'applied', version: task.version, task };
  }

  private async applyListOp(
    tx: Transaction,
    userId: string,
    deviceId: string,
    op: SyncOpInput,
  ): Promise<SyncOpResultDto> {
    if (op.op === 'create') {
      this.assertOnlyListFields(op.patch, false);
      const input = parse(createListSchema, { ...mapListPatch(op.patch), id: op.entityId });
      const list = await this.lists.createInTx(tx, userId, deviceId, input);
      return { opId: op.opId, status: 'applied', version: list.version };
    }

    const [current] = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.id, op.entityId), eq(lists.userId, userId)))
      .limit(1);
    if (!current) {
      return this.rejected(op.opId, 'NOT_FOUND', '清单不存在');
    }
    if (op.op === 'update') {
      if (current.deletedAt) {
        return this.rejected(op.opId, 'DELETED', '清单已删除');
      }
      this.assertOnlyListFields(op.patch, true);
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      const patch = parse(updateListSchema, mapListPatch(op.patch));
      const merge =
        baseVersion < current.version
          ? await this.mergePatch(tx, userId, 'list', op.entityId, baseVersion, patch)
          : { patch, conflictFields: [], merged: false };
      if (Object.keys(merge.patch).length === 0) {
        return {
          opId: op.opId,
          status: merge.conflictFields.length > 0 ? 'conflict' : 'merged',
          version: current.version,
          conflictFields: merge.conflictFields,
        };
      }
      const updated = await this.lists.updateInTx(
        tx,
        userId,
        deviceId,
        op.entityId,
        merge.patch as UpdateListInput,
      );
      return {
        opId: op.opId,
        status: merge.conflictFields.length > 0 ? 'conflict' : merge.merged ? 'merged' : 'applied',
        version: updated.version,
        conflictFields: merge.conflictFields,
      };
    }

    if (op.op === 'delete') {
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      if (current.deletedAt) {
        return { opId: op.opId, status: 'applied', version: current.version };
      }
      await this.lists.deleteInTx(tx, userId, deviceId, op.entityId, {
        taskAction: 'move_to_inbox',
      });
      return { opId: op.opId, status: 'applied', version: current.version + 1 };
    }
    return this.rejected(op.opId, 'VALIDATION_ERROR', '清单不支持该同步操作');
  }

  private async applyTagOp(
    tx: Transaction,
    userId: string,
    deviceId: string,
    op: SyncOpInput,
  ): Promise<SyncOpResultDto> {
    if (op.op === 'create') {
      this.assertOnlyTagFields(op.patch);
      const input = parse(createTagSchema, { ...mapTagPatch(op.patch), id: op.entityId });
      const tag = await this.tags.createInTx(tx, userId, deviceId, input);
      return { opId: op.opId, status: 'applied', version: tag.version };
    }

    const [current] = await tx
      .select()
      .from(tags)
      .where(and(eq(tags.id, op.entityId), eq(tags.userId, userId)))
      .limit(1);
    if (!current) {
      return this.rejected(op.opId, 'NOT_FOUND', '标签不存在');
    }
    if (op.op === 'update') {
      if (current.deletedAt) {
        return this.rejected(op.opId, 'DELETED', '标签已删除');
      }
      this.assertOnlyTagFields(op.patch);
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      const patch = parse(updateTagSchema, mapTagPatch(op.patch));
      const merge =
        baseVersion < current.version
          ? await this.mergePatch(tx, userId, 'tag', op.entityId, baseVersion, patch)
          : { patch, conflictFields: [], merged: false };
      if (Object.keys(merge.patch).length === 0) {
        return {
          opId: op.opId,
          status: merge.conflictFields.length > 0 ? 'conflict' : 'merged',
          version: current.version,
          conflictFields: merge.conflictFields,
        };
      }
      const updated = await this.tags.updateInTx(
        tx,
        userId,
        deviceId,
        op.entityId,
        merge.patch as UpdateTagInput,
      );
      return {
        opId: op.opId,
        status: merge.conflictFields.length > 0 ? 'conflict' : merge.merged ? 'merged' : 'applied',
        version: updated.version,
        conflictFields: merge.conflictFields,
      };
    }

    if (op.op === 'delete') {
      const baseVersion = requireBaseVersion(op);
      if (baseVersion > current.version) {
        return this.rejected(op.opId, 'REBUILD_REQUIRED', '本地版本高于服务端，请全量重建');
      }
      if (current.deletedAt) {
        return { opId: op.opId, status: 'applied', version: current.version };
      }
      await this.tags.deleteInTx(tx, userId, deviceId, op.entityId);
      return { opId: op.opId, status: 'applied', version: current.version + 1 };
    }
    return this.rejected(op.opId, 'VALIDATION_ERROR', '标签不支持该同步操作');
  }

  private async mergePatch(
    tx: Transaction,
    userId: string,
    entity: EntityType,
    entityId: string,
    baseVersion: number,
    patch: Record<string, unknown>,
  ): Promise<MergeResult> {
    const rows = await tx
      .select({ changedFields: changeLog.changedFields })
      .from(changeLog)
      .where(
        and(
          eq(changeLog.userId, userId),
          eq(changeLog.entityType, entity),
          eq(changeLog.entityId, entityId),
          gt(changeLog.entityVersion, baseVersion),
        ),
      );
    const serverChanged = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row.changedFields)) {
        serverChanged.add(key);
      }
    }
    const patchKeys = Object.keys(patch);
    if (serverChanged.size === 0) {
      // The logs for this range are gone; keep server values and report them all.
      return { patch: {}, conflictFields: patchKeys, merged: true };
    }
    const conflictFields = patchKeys.filter((key) => serverChanged.has(key));
    const effective: Record<string, unknown> = {};
    for (const key of patchKeys) {
      if (!serverChanged.has(key)) {
        effective[key] = patch[key];
      }
    }
    return { patch: effective, conflictFields, merged: true };
  }

  private errorResult(opId: string, error: unknown): SyncOpResultDto {
    if (error instanceof ApiError) {
      return {
        opId,
        status: error.code === 'VERSION_CONFLICT' ? 'conflict' : 'rejected',
        error: {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
            requestId: 'sync',
          },
        },
      };
    }
    if (error instanceof ZodError) {
      return this.rejected(opId, 'VALIDATION_ERROR', '参数校验失败', {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    this.logger.error({ opId, err: error }, 'Sync op failed unexpectedly');
    return this.rejected(opId, 'INTERNAL', '处理失败');
  }

  private rejected(
    opId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): SyncOpResultDto {
    return {
      opId,
      status: 'rejected',
      error: { error: { code, message, details, requestId: 'sync' } },
    };
  }

  private cursorExpiredError(
    since: number,
    oldestSeq: number | null,
    currentSeq: number,
  ): ApiError {
    return new ApiError(410, 'CURSOR_EXPIRED', '同步游标已过期，请全量重建', {
      since,
      oldestSeq,
      currentSeq,
    });
  }

  private assertOnlyTaskFields(patch: SyncPatch | undefined): void {
    if (!patch) {
      throw badRequest('create/update 需要 patch');
    }
    const forbiddenKeys = ['name', 'color', 'icon', 'isArchived'].filter((key) => key in patch);
    if (forbiddenKeys.length > 0) {
      throw badRequest('patch 包含任务不支持的字段', { fields: forbiddenKeys });
    }
  }

  private assertOnlyListFields(patch: SyncPatch | undefined, update: boolean): void {
    if (!patch) {
      throw badRequest('create/update 需要 patch');
    }
    const allowed = update
      ? ['name', 'color', 'icon', 'sortRank', 'isArchived']
      : ['name', 'color', 'icon', 'sortRank'];
    const forbidden = Object.keys(patch).filter((key) => !allowed.includes(key));
    if (forbidden.length > 0) {
      throw badRequest('patch 包含清单不支持的字段', { fields: forbidden });
    }
  }

  private assertOnlyTagFields(patch: SyncPatch | undefined): void {
    if (!patch) {
      throw badRequest('create/update 需要 patch');
    }
    const forbidden = Object.keys(patch).filter((key) => !['name', 'color'].includes(key));
    if (forbidden.length > 0) {
      throw badRequest('patch 包含标签不支持的字段', { fields: forbidden });
    }
  }
}

function requireBaseVersion(op: SyncOpInput): number {
  if (op.baseVersion === undefined) {
    throw badRequest(`${op.op} 需要 baseVersion`);
  }
  return op.baseVersion;
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest('参数校验失败', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

function mapTaskPatch(patch: SyncPatch | undefined): Record<string, unknown> {
  if (!patch) {
    return {};
  }
  const taskFields = { ...patch } as Record<string, unknown>;
  delete taskFields.name;
  delete taskFields.color;
  delete taskFields.icon;
  delete taskFields.isArchived;
  return taskFields;
}

function mapListPatch(patch: SyncPatch | undefined): Record<string, unknown> {
  if (!patch) {
    return {};
  }
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.sortRank !== undefined ? { sortRank: patch.sortRank } : {}),
    ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
  };
}

function mapTagPatch(patch: SyncPatch | undefined): Record<string, unknown> {
  if (!patch) {
    return {};
  }
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
  };
}
