import { z } from 'zod';
import type { lists } from '../../db/schema';

export const createListSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(50),
    color: z.string().max(32).optional(),
    icon: z.string().max(32).optional(),
    sortRank: z.string().min(1).max(128).optional(),
  })
  .strict();

export const updateListSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    color: z.string().max(32).optional(),
    icon: z.string().max(32).optional(),
    sortRank: z.string().min(1).max(128).optional(),
    isArchived: z.boolean().optional(),
  })
  .strict();

export const deleteListSchema = z
  .object({
    taskAction: z.enum(['move_to_inbox', 'delete_tasks']).default('move_to_inbox'),
  })
  .strict()
  .optional()
  .transform((value) => value ?? { taskAction: 'move_to_inbox' as const });

export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
export type DeleteListInput = z.infer<typeof deleteListSchema>;

export interface ListDto {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortRank: string;
  isArchived: boolean;
  isDefault: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ListRow = typeof lists.$inferSelect;

export function toListDto(row: ListRow): ListDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortRank: row.sortRank,
    isArchived: row.isArchived,
    isDefault: row.isDefault,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
