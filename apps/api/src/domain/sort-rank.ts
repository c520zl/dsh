import { randomBytes } from 'node:crypto';

/** Task list order is ascending by sortRank; new tasks belong at the top. */
export function newTaskSortRank(now: number = Date.now()): string {
  const inverted = 9_999_999_999_999 - now;
  return `z${inverted.toString(36).padStart(10, '0')}${randomBytes(2).toString('hex')}`;
}

/** Lists keep creation order by default (new list at the bottom). */
export function newListSortRank(now: number = Date.now()): string {
  return `a${now.toString(36).padStart(10, '0')}${randomBytes(2).toString('hex')}`;
}

export function isSortRank(value: string): boolean {
  return value.length >= 1 && value.length <= 128;
}
