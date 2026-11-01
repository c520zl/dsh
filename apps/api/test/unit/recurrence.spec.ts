import { describe, expect, it } from 'vitest';
import {
  nextRecurrence,
  parseRecurrenceRule,
  RecurrenceRuleError,
} from '../../src/domain/recurrence';

function next(
  rule: string,
  options: {
    timezone?: string;
    dtstart: string;
    dueDate?: string | null;
    dueAt?: string | null;
  },
) {
  return nextRecurrence({
    rule: parseRecurrenceRule(rule),
    timezone: options.timezone ?? 'UTC',
    dtstart: new Date(options.dtstart),
    dueDate: options.dueDate ?? null,
    dueAt: options.dueAt ? new Date(options.dueAt) : null,
  });
}

describe('recurrence rule parsing', () => {
  it('normalizes a weekly rule', () => {
    const rule = parseRecurrenceRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(rule.canonical).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(rule.byDay).toEqual([1, 3]);
  });

  it('rejects unsupported COUNT/UNTIL and unknown parts', () => {
    expect(() => parseRecurrenceRule('FREQ=DAILY;COUNT=3')).toThrow(RecurrenceRuleError);
    expect(() => parseRecurrenceRule('FREQ=DAILY;UNTIL=20260101')).toThrow(RecurrenceRuleError);
    expect(() => parseRecurrenceRule('FREQ=DAILY;BYSETPOS=1')).toThrow(RecurrenceRuleError);
    expect(() => parseRecurrenceRule('FREQ=HOURLY')).toThrow(RecurrenceRuleError);
  });

  it('rejects ordinal BYDAY and monthly BYDAY', () => {
    expect(() => parseRecurrenceRule('FREQ=MONTHLY;BYDAY=1MO')).toThrow(RecurrenceRuleError);
  });
});

describe('next recurrence', () => {
  it('advances a weekly rule in the task timezone', () => {
    const occurrence = next('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', {
      timezone: 'Asia/Shanghai',
      dtstart: '2026-11-02T01:00:00.000Z',
      dueAt: '2026-11-02T01:00:00.000Z',
    });
    expect(occurrence.dueAt?.toISOString()).toBe('2026-11-09T01:00:00.000Z');
    expect(occurrence.localDate).toBe('2026-11-09');
  });

  it('clamps monthly day 31 to the last day of short months', () => {
    const february = next('FREQ=MONTHLY', {
      dtstart: '2026-01-31T09:00:00.000Z',
      dueAt: '2026-01-31T09:00:00.000Z',
    });
    expect(february.dueAt?.toISOString()).toBe('2026-02-28T09:00:00.000Z');

    const march = next('FREQ=MONTHLY', {
      dtstart: '2026-01-31T09:00:00.000Z',
      dueAt: '2026-02-28T09:00:00.000Z',
    });
    expect(march.dueAt?.toISOString()).toBe('2026-03-31T09:00:00.000Z');
  });

  it('maps Feb 29 yearly occurrences to Feb 28 in non-leap years', () => {
    const next2025 = next('FREQ=YEARLY', {
      dtstart: '2024-02-29T00:00:00.000Z',
      dueDate: '2024-02-29',
    });
    expect(next2025.dueDate).toBe('2025-02-28');

    const next2028 = next('FREQ=YEARLY', {
      dtstart: '2024-02-29T00:00:00.000Z',
      dueDate: '2027-02-28',
    });
    expect(next2028.dueDate).toBe('2028-02-29');
  });

  it('supports interval > 1 with multiple weekdays', () => {
    const wednesday = next('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', {
      dtstart: '2026-11-02T01:00:00.000Z',
      dueAt: '2026-11-02T01:00:00.000Z',
    });
    expect(wednesday.localDate).toBe('2026-11-04');

    const nextMonday = next('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', {
      dtstart: '2026-11-02T01:00:00.000Z',
      dueAt: '2026-11-04T01:00:00.000Z',
    });
    expect(nextMonday.localDate).toBe('2026-11-16');
  });

  it('shifts a spring-forward gap to the next valid wall time', () => {
    const occurrence = next('FREQ=DAILY', {
      timezone: 'America/New_York',
      dtstart: '2026-03-07T07:30:00.000Z',
      dueAt: '2026-03-07T07:30:00.000Z',
    });
    // 02:30 does not exist on 2026-03-08; the requirement says 03:00 EDT.
    expect(occurrence.dueAt?.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(occurrence.localDate).toBe('2026-03-08');
  });

  it('takes the first (DST) instant during a fall-back overlap', () => {
    const occurrence = next('FREQ=DAILY', {
      timezone: 'America/New_York',
      dtstart: '2026-10-31T05:30:00.000Z',
      dueAt: '2026-10-31T05:30:00.000Z',
    });
    // 01:30 occurs twice on 2026-11-01; the first is EDT (UTC-4).
    expect(occurrence.dueAt?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('keeps all-day dates stable across timezones', () => {
    const occurrence = next('FREQ=DAILY;INTERVAL=2', {
      timezone: 'Asia/Shanghai',
      dtstart: '2026-11-01T00:00:00.000Z',
      dueDate: '2026-11-01',
    });
    expect(occurrence.dueDate).toBe('2026-11-03');
  });
});
