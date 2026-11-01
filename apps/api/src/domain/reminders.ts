import { addMinutes, occurrenceKeyFor, parseReminderTime, zonedWallTimeToUtc } from './time';

export interface ReminderTaskLike {
  dueDate: string | null;
  dueAt: Date | null;
}

export interface MaterializedReminder {
  id: string;
  remindAt: Date;
}

export function currentOccurrenceKey(task: ReminderTaskLike): string | null {
  return occurrenceKeyFor(task.dueDate, task.dueAt);
}

export function reminderTimes(
  task: ReminderTaskLike,
  specs: Array<{ id: string; offsetMinutes: number }>,
  options: { userTimezone: string; defaultReminderTime: string },
): MaterializedReminder[] {
  if (!task.dueDate && !task.dueAt) {
    return [];
  }
  let base: Date;
  if (task.dueAt) {
    base = task.dueAt;
  } else {
    const { hour, minute } = parseReminderTime(options.defaultReminderTime);
    base = zonedWallTimeToUtc(options.userTimezone, task.dueDate as string, hour, minute);
  }
  return specs.map((spec) => ({
    id: spec.id,
    remindAt: addMinutes(base, spec.offsetMinutes),
  }));
}
