import { DateTime } from 'luxon';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class TimezoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimezoneError';
  }
}

export function isValidTimezone(zone: string): boolean {
  if (!zone || zone.length > 64) {
    return false;
  }
  try {
    return DateTime.now().setZone(zone).isValid;
  } catch {
    return false;
  }
}

export function assertTimezone(zone: string): string {
  if (!isValidTimezone(zone)) {
    throw new TimezoneError(`Invalid IANA timezone: ${zone}`);
  }
  return zone;
}

export function isDateString(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false;
  }
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid && parsed.toISODate() === value;
}

export function assertDateString(value: string): string {
  if (!isDateString(value)) {
    throw new TimezoneError(`Invalid calendar date: ${value}`);
  }
  return value;
}

export function nextDate(date: string): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days: 1 }).toISODate() as string;
}

export function daysInMonth(year: number, month: number): number {
  return DateTime.fromObject({ year, month, day: 1 }, { zone: 'utc' }).endOf('month').day as number;
}

/**
 * Resolve a local wall-clock time in an IANA zone to a UTC instant.
 *
 * DST rules from the requirements:
 * - non-existent local time (spring forward): shift forward to the next valid
 *   wall time (02:30 in a 1h gap -> 03:00);
 * - repeated local time (fall back): take the first/earlier instant (DST offset).
 */
export function zonedWallTimeToUtc(zone: string, date: string, hour: number, minute: number): Date {
  assertTimezone(zone);
  const [year, month, day] = date.split('-').map(Number);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const exact = matchWallTime(zone, wallMs);
  if (exact !== null) {
    return new Date(exact);
  }

  // Gap: walk the wall clock forward minute by minute until a valid instant.
  for (let add = 1; add <= 180; add += 1) {
    const shifted = matchWallTime(zone, wallMs + add * 60_000);
    if (shifted !== null) {
      return new Date(shifted);
    }
  }
  throw new TimezoneError(`Cannot resolve ${date} ${hour}:${minute} in ${zone}`);
}

function matchWallTime(zone: string, wallMs: number): number | null {
  const offsets = new Set<number>();
  for (const deltaMs of [-36 * 3_600_000, 0, 36 * 3_600_000]) {
    offsets.add(DateTime.fromMillis(wallMs + deltaMs, { zone }).offset);
  }
  const wall = DateTime.fromMillis(wallMs, { zone: 'utc' });
  const matches: number[] = [];
  for (const offset of offsets) {
    const utcMs = wallMs - offset * 60_000;
    const local = DateTime.fromMillis(utcMs, { zone });
    if (
      local.year === wall.year &&
      local.month === wall.month &&
      local.day === wall.day &&
      local.hour === wall.hour &&
      local.minute === wall.minute
    ) {
      matches.push(utcMs);
    }
  }
  if (matches.length === 0) {
    return null;
  }
  // Fall-back overlap: the earlier UTC instant is the first (DST) occurrence.
  return Math.min(...matches);
}

export function localDateOf(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toISODate() as string;
}

export function localDateTimeOf(date: Date, zone: string): DateTime {
  return DateTime.fromJSDate(date, { zone });
}

export function localDayBounds(
  zone: string,
  date?: string,
): {
  date: string;
  start: Date;
  end: Date;
} {
  assertTimezone(zone);
  const localDate = date ?? (DateTime.now().setZone(zone).toISODate() as string);
  return {
    date: localDate,
    start: zonedWallTimeToUtc(zone, localDate, 0, 0),
    end: zonedWallTimeToUtc(zone, nextDate(localDate), 0, 0),
  };
}

export function parseReminderTime(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new TimezoneError(`Invalid time of day: ${value}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function occurrenceKeyFor(dueDate: string | null, dueAt: Date | null): string | null {
  if (dueDate) {
    return `date:${dueDate}`;
  }
  if (dueAt) {
    return `at:${dueAt.toISOString()}`;
  }
  return null;
}

export function nowDate(): Date {
  return new Date();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
