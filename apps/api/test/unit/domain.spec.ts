import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  isValidTimezone,
  localDateOf,
  localDayBounds,
  occurrenceKeyFor,
  zonedWallTimeToUtc,
} from '../../src/domain/time';
import { newListSortRank, newTaskSortRank } from '../../src/domain/sort-rank';
import { uuidv7 } from '../../src/domain/ids';

describe('timezone helpers', () => {
  it('validates IANA timezones', () => {
    expect(isValidTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });

  it('resolves wall times across DST gaps and overlaps', () => {
    expect(zonedWallTimeToUtc('America/New_York', '2026-03-08', 2, 30).toISOString()).toBe(
      '2026-03-08T07:00:00.000Z',
    );
    expect(zonedWallTimeToUtc('America/New_York', '2026-11-01', 1, 30).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(zonedWallTimeToUtc('Asia/Shanghai', '2026-11-02', 9, 0).toISOString()).toBe(
      '2026-11-02T01:00:00.000Z',
    );
  });

  it('computes local day bounds', () => {
    const bounds = localDayBounds('Asia/Shanghai', '2026-11-02');
    expect(bounds.start.toISOString()).toBe('2026-11-01T16:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-11-02T16:00:00.000Z');
    expect(localDateOf(new Date('2026-11-01T16:30:00.000Z'), 'Asia/Shanghai')).toBe('2026-11-02');
  });

  it('builds occurrence keys and applies minute offsets', () => {
    expect(occurrenceKeyFor('2026-11-02', null)).toBe('date:2026-11-02');
    expect(occurrenceKeyFor(null, new Date('2026-11-02T01:00:00.000Z'))).toBe(
      'at:2026-11-02T01:00:00.000Z',
    );
    expect(addMinutes(new Date('2026-11-02T01:00:00.000Z'), -30).toISOString()).toBe(
      '2026-11-02T00:30:00.000Z',
    );
  });
});

describe('sort ranks and ids', () => {
  it('sorts newer tasks before older tasks', () => {
    const older = newTaskSortRank(1_000_000);
    const newer = newTaskSortRank(2_000_000);
    expect(newer < older).toBe(true);
  });

  it('sorts newer lists after older lists by default', () => {
    expect(newListSortRank(1_000_000) < newListSortRank(2_000_000)).toBe(true);
  });

  it('generates version 7 UUIDs', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
