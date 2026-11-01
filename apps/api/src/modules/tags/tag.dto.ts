import { z } from 'zod';
import type { tags } from '../../db/schema';

export const createTagSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(30),
    color: z.string().max(32).optional(),
  })
  .strict();

export const updateTagSchema = z
  .object({
    name: z.string().trim().min(1).max(30).optional(),
    color: z.string().max(32).optional(),
  })
  .strict();

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export interface TagDto {
  id: string;
  name: string;
  color: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type TagRow = typeof tags.$inferSelect;

export function toTagDto(row: TagRow): TagDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
