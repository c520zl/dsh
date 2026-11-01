import { DateTime } from 'luxon';
import { daysInMonth, isValidTimezone, localDateOf, zonedWallTimeToUtc } from './time';

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type WeekStart = 'MO' | 'SU';

export interface ParsedRecurrenceRule {
  freq: RecurrenceFrequency;
  interval: number;
  byDay: number[];
  byMonthDay: number[];
  byMonth: number[];
  weekStart: WeekStart;
  canonical: string;
}

export class RecurrenceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceRuleError';
  }
}

const WEEKDAYS: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

const FREQUENCIES: RecurrenceFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const ALLOWED_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST']);

/**
 * Parse the RRULE subset supported by the MVP:
 * FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, BYDAY (weekday codes only),
 * BYMONTHDAY, BYMONTH and WKST. COUNT/UNTIL live in dedicated API fields.
 */
export function parseRecurrenceRule(raw: string): ParsedRecurrenceRule {
  const source = raw.trim().replace(/^RRULE:/i, '');
  if (source.length === 0) {
    throw new RecurrenceRuleError('recurrence.rule must not be empty');
  }
  if (source.length > 512) {
    throw new RecurrenceRuleError('recurrence.rule must be at most 512 characters');
  }

  const parts = new Map<string, string>();
  for (const chunk of source.split(';')) {
    if (chunk.length === 0) {
      continue;
    }
    const eq = chunk.indexOf('=');
    if (eq <= 0 || eq === chunk.length - 1) {
      throw new RecurrenceRuleError(`Invalid RRULE part: ${chunk}`);
    }
    const key = chunk.slice(0, eq).trim().toUpperCase();
    const value = chunk
      .slice(eq + 1)
      .trim()
      .toUpperCase();
    if (!ALLOWED_PARTS.has(key)) {
      if (key === 'COUNT' || key === 'UNTIL') {
        throw new RecurrenceRuleError(
          'COUNT and UNTIL must be provided as recurrence.countRemaining / recurrence.until',
        );
      }
      throw new RecurrenceRuleError(`Unsupported RRULE part: ${key}`);
    }
    if (parts.has(key)) {
      throw new RecurrenceRuleError(`Duplicate RRULE part: ${key}`);
    }
    parts.set(key, value);
  }

  const freq = parts.get('FREQ');
  if (!freq || !FREQUENCIES.includes(freq as RecurrenceFrequency)) {
    throw new RecurrenceRuleError('FREQ must be one of DAILY, WEEKLY, MONTHLY, YEARLY');
  }

  const interval = Number(parts.get('INTERVAL') ?? '1');
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new RecurrenceRuleError('INTERVAL must be an integer between 1 and 999');
  }

  const byDay = parseByDay(parts.get('BYDAY'), freq as RecurrenceFrequency);
  const byMonthDay = parseIntegerList(parts.get('BYMONTHDAY'), 1, 31, true, 'BYMONTHDAY');
  const byMonth = parseIntegerList(parts.get('BYMONTH'), 1, 12, false, 'BYMONTH');
  const weekStart = (parts.get('WKST') ?? 'MO') as WeekStart;
  if (weekStart !== 'MO' && weekStart !== 'SU') {
    throw new RecurrenceRuleError('WKST must be MO or SU');
  }

  if ((freq === 'MONTHLY' || freq === 'YEARLY') && byDay.length > 0) {
    throw new RecurrenceRuleError('BYDAY is only supported for DAILY/WEEKLY rules');
  }
  if (freq === 'WEEKLY' && byMonthDay.length > 0) {
    throw new RecurrenceRuleError('BYMONTHDAY is not supported for WEEKLY rules');
  }

  const canonicalParts = [`FREQ=${freq}`];
  if (interval !== 1) {
    canonicalParts.push(`INTERVAL=${interval}`);
  }
  if (byDay.length > 0) {
    canonicalParts.push(
      `BYDAY=${byDay
        .slice()
        .sort((a, b) => a - b)
        .map((day) => Object.keys(WEEKDAYS).find((code) => WEEKDAYS[code] === day))
        .join(',')}`,
    );
  }
  if (byMonthDay.length > 0) {
    canonicalParts.push(`BYMONTHDAY=${byMonthDay.join(',')}`);
  }
  if (byMonth.length > 0) {
    canonicalParts.push(`BYMONTH=${byMonth.join(',')}`);
  }
  if (weekStart !== 'MO') {
    canonicalParts.push(`WKST=${weekStart}`);
  }

  return {
    freq: freq as RecurrenceFrequency,
    interval,
    byDay,
    byMonthDay,
    byMonth,
    weekStart,
    canonical: canonicalParts.join(';'),
  };
}

function parseByDay(value: string | undefined, freq: RecurrenceFrequency): number[] {
  if (!value) {
    return [];
  }
  if (freq !== 'DAILY' && freq !== 'WEEKLY') {
    throw new RecurrenceRuleError('BYDAY is only supported for DAILY/WEEKLY rules');
  }
  const result = new Set<number>();
  for (const token of value.split(',')) {
    const code = token.trim();
    if (!(code in WEEKDAYS)) {
      throw new RecurrenceRuleError(`Invalid BYDAY value: ${token}`);
    }
    result.add(WEEKDAYS[code] as number);
  }
  return [...result].sort((a, b) => a - b);
}

function parseIntegerList(
  value: string | undefined,
  minAbs: number,
  maxAbs: number,
  allowNegative: boolean,
  field: string,
): number[] {
  if (!value) {
    return [];
  }
  const result: number[] = [];
  for (const token of value.split(',')) {
    const parsed = Number(token.trim());
    const abs = Math.abs(parsed);
    if (
      !Number.isInteger(parsed) ||
      parsed === 0 ||
      abs < minAbs ||
      abs > maxAbs ||
      (!allowNegative && token.trim().startsWith('-'))
    ) {
      throw new RecurrenceRuleError(`Invalid ${field} value: ${token}`);
    }
    result.push(parsed);
  }
  return [...new Set(result)];
}

export interface RecurrenceInput {
  rule: ParsedRecurrenceRule;
  timezone: string;
  dtstart: Date;
  dueDate: string | null;
  dueAt: Date | null;
}

export interface RecurrenceOccurrence {
  dueDate: string | null;
  dueAt: Date | null;
  localDate: string;
}

/**
 * Compute the next occurrence after the task's current due date/at. Returns
 * wall-clock dates before count/until termination, which the caller evaluates.
 */
export function nextRecurrence(input: RecurrenceInput): RecurrenceOccurrence {
  if (!isValidTimezone(input.timezone)) {
    throw new RecurrenceRuleError(`Invalid recurrence timezone: ${input.timezone}`);
  }
  const timed = input.dueAt !== null;
  const currentLocalDate = timed
    ? localDateOf(input.dueAt as Date, input.timezone)
    : (input.dueDate as string);
  if (!currentLocalDate) {
    throw new RecurrenceRuleError('A recurring task requires dueDate or dueAt');
  }

  const currentDate = DateTime.fromISO(currentLocalDate, { zone: 'utc' });
  const anchorDate = DateTime.fromISO(localDateOf(input.dtstart, input.timezone), {
    zone: 'utc',
  });
  const currentWall = DateTime.fromJSDate(input.dueAt ?? input.dtstart, {
    zone: input.timezone,
  });
  const hour = currentWall.hour;
  const minute = currentWall.minute;

  const nextDate = findNextDate(input.rule, currentDate, anchorDate);
  const localDate = nextDate.toISODate() as string;

  if (timed) {
    return {
      dueDate: null,
      dueAt: zonedWallTimeToUtc(input.timezone, localDate, hour, minute),
      localDate,
    };
  }
  return { dueDate: localDate, dueAt: null, localDate };
}

function findNextDate(
  rule: ParsedRecurrenceRule,
  currentDate: DateTime,
  anchorDate: DateTime,
): DateTime {
  switch (rule.freq) {
    case 'DAILY':
      return findNextDaily(rule, currentDate);
    case 'WEEKLY':
      return findNextWeekly(rule, currentDate, anchorDate);
    case 'MONTHLY':
      return findNextMonthly(rule, currentDate, anchorDate);
    case 'YEARLY':
      return findNextYearly(rule, currentDate, anchorDate);
  }
}

function findNextDaily(rule: ParsedRecurrenceRule, currentDate: DateTime): DateTime {
  let candidate = currentDate.plus({ days: rule.interval });
  for (let i = 0; i < 3000; i += 1) {
    if (matchesFilters(rule, candidate)) {
      return candidate;
    }
    candidate = candidate.plus({ days: rule.interval });
  }
  throw new RecurrenceRuleError('Cannot compute the next daily occurrence');
}

function findNextWeekly(
  rule: ParsedRecurrenceRule,
  currentDate: DateTime,
  anchorDate: DateTime,
): DateTime {
  const startIso = rule.weekStart === 'SU' ? 7 : 1;
  const allowedDays = rule.byDay.length > 0 ? rule.byDay : [anchorDate.weekday];
  const currentWeekStart = weekStartOf(currentDate, startIso);

  for (let weekIndex = 0; weekIndex < 1060; weekIndex += 1) {
    const week = currentWeekStart.plus({ weeks: weekIndex * rule.interval });
    for (let offset = 0; offset < 7; offset += 1) {
      const candidate = week.plus({ days: offset });
      if (candidate <= currentDate) {
        continue;
      }
      if (!allowedDays.includes(candidate.weekday)) {
        continue;
      }
      if (rule.byMonth.length > 0 && !rule.byMonth.includes(candidate.month)) {
        continue;
      }
      return candidate;
    }
  }
  throw new RecurrenceRuleError('Cannot compute the next weekly occurrence');
}

function findNextMonthly(
  rule: ParsedRecurrenceRule,
  currentDate: DateTime,
  anchorDate: DateTime,
): DateTime {
  const monthStart = currentDate.startOf('month');
  for (let monthIndex = 0; monthIndex < 1200; monthIndex += 1) {
    const month = monthStart.plus({ months: monthIndex * rule.interval });
    if (rule.byMonth.length > 0 && !rule.byMonth.includes(month.month)) {
      continue;
    }
    const days = resolveDaysOfMonth(rule, month, anchorDate);
    for (const day of days) {
      const candidate = DateTime.fromObject(
        { year: month.year, month: month.month, day },
        { zone: 'utc' },
      );
      if (candidate > currentDate) {
        return candidate;
      }
    }
  }
  throw new RecurrenceRuleError('Cannot compute the next monthly occurrence');
}

function findNextYearly(
  rule: ParsedRecurrenceRule,
  currentDate: DateTime,
  anchorDate: DateTime,
): DateTime {
  for (let yearIndex = 0; yearIndex < 500; yearIndex += 1) {
    const year = currentDate.year + yearIndex * rule.interval;
    const months = rule.byMonth.length > 0 ? rule.byMonth : [anchorDate.month];
    for (const month of months) {
      const maxDay = daysInMonth(year, month);
      const days =
        rule.byMonthDay.length > 0
          ? rule.byMonthDay.map((value) =>
              value < 0 ? maxDay + value + 1 : Math.min(value, maxDay),
            )
          : [Math.min(anchorDate.day, maxDay)];
      for (const day of [...new Set(days)].sort((a, b) => a - b)) {
        const candidate = DateTime.fromObject({ year, month, day }, { zone: 'utc' });
        if (candidate > currentDate) {
          return candidate;
        }
      }
    }
  }
  throw new RecurrenceRuleError('Cannot compute the next yearly occurrence');
}

function resolveDaysOfMonth(
  rule: ParsedRecurrenceRule,
  month: DateTime,
  anchorDate: DateTime,
): number[] {
  const maxDay = month.daysInMonth as number;
  const days =
    rule.byMonthDay.length > 0
      ? rule.byMonthDay.map((value) => (value < 0 ? maxDay + value + 1 : Math.min(value, maxDay)))
      : [Math.min(anchorDate.day, maxDay)];
  return [...new Set(days)].sort((a, b) => a - b);
}

function matchesFilters(rule: ParsedRecurrenceRule, candidate: DateTime): boolean {
  if (rule.byDay.length > 0 && !rule.byDay.includes(candidate.weekday)) {
    return false;
  }
  if (rule.byMonth.length > 0 && !rule.byMonth.includes(candidate.month)) {
    return false;
  }
  if (rule.byMonthDay.length > 0) {
    const maxDay = candidate.daysInMonth as number;
    const days = rule.byMonthDay.map((value) =>
      value < 0 ? maxDay + value + 1 : Math.min(value, maxDay),
    );
    if (!days.includes(candidate.day)) {
      return false;
    }
  }
  return true;
}

function weekStartOf(date: DateTime, startIso: number): DateTime {
  const diff = (date.weekday - startIso + 7) % 7;
  return date.minus({ days: diff }).startOf('day');
}
