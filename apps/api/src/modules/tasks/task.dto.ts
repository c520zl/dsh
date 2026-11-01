import { z } from 'zod';
import type { tasks } from '../../db/schema';

const reminderSpecSchema = z
  .object({
    id: z.uuid(),
    offsetMinutes: z.number().int().min(-10080).max(1440),
  })
  .strict();

const recurrenceSchema = z
  .object({
    rule: z.string().min(1).max(512),
    timezone: z.string().min(1).max(64),
    dtstart: z.iso.datetime(),
    until: z.iso.date().nullable().optional(),
    countRemaining: z.number().int().min(0).nullable().optional(),
    seq: z.number().int().min(0),
  })
  .strict();

const baseTaskFields = {
  listId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10000).optional(),
  priority: z.number().int().min(0).max(3).optional(),
  dueDate: z.iso.date().nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  reminderSpec: z.array(reminderSpecSchema).max(5).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  tagIds: z.array(z.uuid()).max(10).optional(),
  sortRank: z.string().min(1).max(128).optional(),
};

export const createTaskSchema = z
  .object({
    id: z.uuid().optional(),
    ...baseTaskFields,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dueDate && value.dueAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'dueDate 与 dueAt 不能同时设置',
      });
    }
    if ((value.reminderSpec?.length ?? 0) > 0 && !value.dueDate && !value.dueAt) {
      ctx.addIssue({ code: 'custom', path: ['reminderSpec'], message: '提醒需要到期日期或时间' });
    }
    if (value.recurrence && !value.dueDate && !value.dueAt) {
      ctx.addIssue({ code: 'custom', path: ['recurrence'], message: '重复任务需要到期日期或时间' });
    }
    addDuplicateIssues(value, ctx);
  });

export const updateTaskSchema = z
  .object({
    ...baseTaskFields,
    title: z.string().trim().min(1).max(500).optional(),
    parentId: z.uuid().nullable().optional(),
    completedAt: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dueDate && value.dueAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'dueDate 与 dueAt 不能同时设置',
      });
    }
    addDuplicateIssues(value, ctx);
  });

export const completeTaskSchema = z
  .object({
    occurrenceKey: z.string().min(1).max(128).optional(),
    completionId: z.uuid(),
  })
  .strict();

export const uncompleteTaskSchema = z
  .object({
    completionId: z.uuid(),
  })
  .strict();

export const batchTaskSchema = z
  .object({
    action: z.enum(['complete', 'delete', 'move']),
    taskIds: z.array(z.uuid()).min(1).max(100),
    targetListId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'move' && !value.targetListId) {
      ctx.addIssue({ code: 'custom', path: ['targetListId'], message: 'move 需要 targetListId' });
    }
    if (new Set(value.taskIds).size !== value.taskIds.length) {
      ctx.addIssue({ code: 'custom', path: ['taskIds'], message: 'taskIds 不能重复' });
    }
  });

export const reorderTasksSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            taskId: z.uuid(),
            sortRank: z.string().min(1).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.items.map((item) => item.taskId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'taskId 不能重复' });
    }
  });

export const taskListViewSchema = z
  .enum(['today', 'upcoming', 'all', 'completed', 'trash'])
  .optional();
export const taskStatusSchema = z.enum(['open', 'completed', 'deleted']).optional();

export const listTasksQuerySchema = z
  .object({
    view: taskListViewSchema,
    listId: z.uuid().optional(),
    status: taskStatusSchema,
    q: z.string().max(200).optional(),
    dueFrom: z.iso.date().optional(),
    dueTo: z.iso.date().optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type UncompleteTaskInput = z.infer<typeof uncompleteTaskSchema>;
export type BatchTaskInput = z.infer<typeof batchTaskSchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

function addDuplicateIssues(
  value: { reminderSpec?: Array<{ id: string }>; tagIds?: string[] },
  ctx: z.RefinementCtx,
): void {
  if (value.reminderSpec) {
    const ids = value.reminderSpec.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['reminderSpec'], message: '提醒 ID 不能重复' });
    }
  }
  if (value.tagIds && new Set(value.tagIds).size !== value.tagIds.length) {
    ctx.addIssue({ code: 'custom', path: ['tagIds'], message: '标签不能重复' });
  }
}

export interface RecurrenceDto {
  rule: string;
  timezone: string;
  dtstart: string;
  until: string | null;
  countRemaining: number | null;
  seq: number;
}

export interface TaskDto {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string;
  priority: number;
  dueDate: string | null;
  dueAt: string | null;
  completedAt: string | null;
  lastCompletedAt: string | null;
  reminderSpec: Array<{ id: string; offsetMinutes: number }>;
  recurrence: RecurrenceDto | null;
  tagIds: string[];
  sortRank: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type TaskRow = typeof tasks.$inferSelect;

export function toTaskDto(row: TaskRow, tagIds: string[] = []): TaskDto {
  return {
    id: row.id,
    listId: row.listId,
    parentId: row.parentId,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    dueDate: row.dueDate,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    lastCompletedAt: row.lastCompletedAt ? row.lastCompletedAt.toISOString() : null,
    reminderSpec: row.reminderSpec,
    recurrence:
      row.recurrenceRule && row.recurrenceDtstart && row.recurrenceTimezone
        ? {
            rule: row.recurrenceRule,
            timezone: row.recurrenceTimezone,
            dtstart: row.recurrenceDtstart.toISOString(),
            until: row.recurrenceUntil,
            countRemaining: row.recurrenceCountRemaining,
            seq: row.recurrenceSeq,
          }
        : null,
    tagIds,
    sortRank: row.sortRank,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export interface TaskPageDto {
  items: TaskDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CompleteTaskResponseDto {
  task: TaskDto;
  status: 'completed' | 'already_completed';
  completionId: string;
}

export interface BatchTaskResultDto {
  taskId: string;
  status: 'applied' | 'rejected' | 'conflict';
  task?: TaskDto;
  error?: {
    error: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
      requestId: string;
    };
  };
}

export interface BatchTaskResponseDto {
  results: BatchTaskResultDto[];
}
