import { z } from 'zod';

export const reminderSpecSchema = z
  .object({
    id: z.uuid(),
    offsetMinutes: z.number().int().min(-10080).max(1440),
  })
  .strict();

export const recurrenceSchema = z
  .object({
    rule: z.string().min(1).max(512),
    timezone: z.string().min(1).max(64),
    dtstart: z.iso.datetime(),
    until: z.iso.date().nullable().optional(),
    countRemaining: z.number().int().min(0).nullable().optional(),
    seq: z.number().int().min(0),
  })
  .strict();

export const syncPatchSchema = z
  .object({
    title: z.string().max(500).optional(),
    notes: z.string().max(10000).optional(),
    listId: z.uuid().optional(),
    parentId: z.uuid().nullable().optional(),
    priority: z.number().int().min(0).max(3).optional(),
    dueDate: z.iso.date().nullable().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    reminderSpec: z.array(reminderSpecSchema).max(5).optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    tagIds: z.array(z.uuid()).max(10).optional(),
    sortRank: z.string().min(1).max(128).optional(),
    name: z.string().max(50).optional(),
    color: z.string().max(32).optional(),
    icon: z.string().max(32).optional(),
    isArchived: z.boolean().optional(),
  })
  .strict();

export const syncOpSchema = z
  .object({
    opId: z.uuid(),
    entity: z.enum(['task', 'list', 'tag']),
    entityId: z.uuid(),
    op: z.enum(['create', 'update', 'delete', 'complete', 'uncomplete']),
    baseVersion: z.number().int().min(0).optional(),
    patch: syncPatchSchema.optional(),
    occurrenceKey: z.string().min(1).max(128).optional(),
    completionId: z.uuid().optional(),
  })
  .strict();

export const syncPushSchema = z
  .object({
    deviceId: z.uuid(),
    localDeliveries: z
      .array(
        z
          .object({
            reminderId: z.uuid(),
            occurrenceKey: z.string().min(1).max(128),
            deliveredAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    ops: z.array(syncOpSchema).min(1).max(100),
  })
  .strict();

export const syncPullQuerySchema = z
  .object({
    since: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(500).default(500),
  })
  .strict();

export type SyncPushInput = z.infer<typeof syncPushSchema>;
export type SyncOpInput = z.infer<typeof syncOpSchema>;
export type SyncPatch = z.infer<typeof syncPatchSchema>;
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export interface SyncOpResultDto {
  opId: string;
  status: 'applied' | 'merged' | 'conflict' | 'already_completed' | 'rejected';
  version?: number | null;
  conflictFields?: string[];
  task?: unknown;
  error?: {
    error: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
      requestId: string;
    };
  };
}

export interface SyncPushResponseDto {
  results: SyncOpResultDto[];
}

export interface SyncChangeDto {
  seq: number;
  entity: 'task' | 'list' | 'tag';
  entityId: string;
  op: 'upsert' | 'delete';
  version: number;
  changedFields: Record<string, unknown>;
}

export interface SyncPullResponseDto {
  changes: SyncChangeDto[];
  nextCursor: number;
  hasMore: boolean;
}

export interface SyncSnapshotResponseDto {
  cursor: number;
}
