import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle mapping of docs/sql/001_init.sql (the canonical DDL).
 *
 * The database is created by applying the SQL baseline, not by drizzle-kit, so
 * indexes/foreign keys are intentionally not re-declared here; this file only
 * provides typed table access for queries. `drizzle.config.ts` is available for
 * generating future migrations from these definitions.
 */
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const identity = pgSchema('identity');
export const todo = pgSchema('todo');
export const notify = pgSchema('notify');
export const sync = pgSchema('sync');
export const ops = pgSchema('ops');

export const users = identity.table('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull(),
  displayName: text('display_name').notNull(),
  avatar: text('avatar'),
  timezone: text('timezone').notNull().default('UTC'),
  locale: text('locale').notNull().default('zh-CN'),
  authVersion: bigint('auth_version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export const authIdentities = identity.table('auth_identities', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const devices = identity.table('devices', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  appVersion: text('app_version'),
  osVersion: text('os_version'),
  pushToken: text('push_token'),
  pushProvider: text('push_provider'),
  authVersion: bigint('auth_version', { mode: 'number' }).notNull().default(1),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  revokedAt: timestamptz('revoked_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const refreshTokens = identity.table('refresh_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  familyId: uuid('family_id').notNull(),
  replacedById: uuid('replaced_by_id'),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  rotatedAt: timestamptz('rotated_at'),
  revokedAt: timestamptz('revoked_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const userSettings = identity.table('user_settings', {
  userId: uuid('user_id').primaryKey(),
  theme: text('theme').notNull().default('system'),
  accent: text('accent').notNull().default('coral'),
  weekStart: text('week_start').notNull().default('monday'),
  defaultListId: uuid('default_list_id'),
  defaultReminderTime: time('default_reminder_time').notNull().default('09:00'),
  timeFormat: text('time_format').notNull().default('24h'),
  quietHoursStart: time('quiet_hours_start'),
  quietHoursEnd: time('quiet_hours_end'),
  notificationPrefs: jsonb('notification_prefs')
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const lists = todo.table('lists', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('coral'),
  icon: text('icon').notNull().default('list'),
  sortRank: text('sort_rank').notNull(),
  isArchived: boolean('is_archived').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export const tags = todo.table('tags', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('slate'),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export type ReminderSpecRow = { id: string; offsetMinutes: number };

export const tasks = todo.table('tasks', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  listId: uuid('list_id').notNull(),
  parentId: uuid('parent_id'),
  title: text('title').notNull(),
  notes: text('notes').notNull().default(''),
  priority: smallint('priority').notNull().default(0),
  dueDate: date('due_date'),
  dueAt: timestamptz('due_at'),
  completedAt: timestamptz('completed_at'),
  lastCompletedAt: timestamptz('last_completed_at'),
  recurrenceRule: text('recurrence_rule'),
  recurrenceDtstart: timestamptz('recurrence_dtstart'),
  recurrenceUntil: date('recurrence_until'),
  recurrenceCountRemaining: smallint('recurrence_count_remaining'),
  recurrenceSeq: integer('recurrence_seq').notNull().default(0),
  recurrenceTimezone: text('recurrence_timezone'),
  reminderSpec: jsonb('reminder_spec').$type<ReminderSpecRow[]>().notNull().default([]),
  sortRank: text('sort_rank').notNull(),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export const taskTags = todo.table(
  'task_tags',
  {
    userId: uuid('user_id').notNull(),
    taskId: uuid('task_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.tagId] })],
);

export const taskCompletions = todo.table('task_completions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  taskId: uuid('task_id').notNull(),
  occurrenceKey: text('occurrence_key').notNull(),
  occurrenceDueAt: timestamptz('occurrence_due_at'),
  occurrenceDueDate: date('occurrence_due_date'),
  completedAt: timestamptz('completed_at').notNull(),
  deviceId: uuid('device_id'),
  previousDueAt: timestamptz('previous_due_at'),
  previousDueDate: date('previous_due_date'),
  previousCountRemaining: smallint('previous_count_remaining'),
  previousSeq: integer('previous_seq'),
  previousLastCompletedAt: timestamptz('previous_last_completed_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const attachments = todo.table('attachments', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  taskId: uuid('task_id').notNull(),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  checksum: text('checksum').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export const reminders = notify.table('reminders', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  taskId: uuid('task_id').notNull(),
  reminderKey: text('reminder_key').notNull(),
  occurrenceKey: text('occurrence_key').notNull(),
  remindAt: timestamptz('remind_at').notNull(),
  status: text('status').notNull().default('pending'),
  claimedAt: timestamptz('claimed_at'),
  sentAt: timestamptz('sent_at'),
  attemptCount: smallint('attempt_count').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const userSyncState = sync.table('user_sync_state', {
  userId: uuid('user_id').primaryKey(),
  currentSeq: bigint('current_seq', { mode: 'number' }).notNull().default(0),
});

export const changeLog = sync.table(
  'change_log',
  {
    userId: uuid('user_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    entityVersion: bigint('entity_version', { mode: 'number' }).notNull(),
    op: text('op').notNull(),
    changedFields: jsonb('changed_fields').$type<Record<string, unknown>>().notNull().default({}),
    deviceId: uuid('device_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.seq] })],
);

export const processedOps = sync.table(
  'processed_ops',
  {
    userId: uuid('user_id').notNull(),
    opId: uuid('op_id').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.opId] })],
);

export const exportJobs = ops.table('export_jobs', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  status: text('status').notNull().default('pending'),
  format: text('format').notNull(),
  storageKey: text('storage_key'),
  error: text('error'),
  expiresAt: timestamptz('expires_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const auditLog = ops.table('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  userId: uuid('user_id'),
  event: text('event').notNull(),
  ipHash: text('ip_hash'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const schema = {
  users,
  authIdentities,
  devices,
  refreshTokens,
  userSettings,
  lists,
  tags,
  tasks,
  taskTags,
  taskCompletions,
  attachments,
  reminders,
  userSyncState,
  changeLog,
  processedOps,
  exportJobs,
  auditLog,
};
