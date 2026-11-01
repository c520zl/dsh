-- =============================================================================
-- Todo App — 001_init.sql
-- PostgreSQL 18+
--
-- 说明：
--   - 迁移按 expand/contract 管理；本文件是初始基线，可重复审阅。
--   - UUID 由客户端/服务端应用生成（UUIDv7），数据库不依赖扩展生成主键。
--   - 所有时间戳为 timestamptz（UTC）；due_date 为用户本地日历日期。
--   - 软删除使用 deleted_at；硬清理由后台任务执行。
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS todo;
CREATE SCHEMA IF NOT EXISTS notify;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS ops;

-- =============================================================================
-- identity
-- =============================================================================

CREATE TABLE identity.users (
  id              uuid PRIMARY KEY,
  email           citext NOT NULL,
  display_name    text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 50),
  avatar          text,
  timezone        text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  locale          text NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN', 'en')),
  auth_version    bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX users_email_active
  ON identity.users (email)
  WHERE deleted_at IS NULL;

CREATE TABLE identity.auth_identities (
  id                    uuid PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('apple', 'google', 'email')),
  provider_user_id      text NOT NULL CHECK (char_length(provider_user_id) BETWEEN 1 AND 255),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX auth_identities_user_idx ON identity.auth_identities (user_id);

CREATE TABLE identity.devices (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  platform        text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version     text,
  os_version      text,
  push_token      text,
  push_provider   text CHECK (push_provider IN ('apns', 'fcm', 'expo', 'huawei', 'xiaomi', 'oppo', 'vivo', 'jpush', 'getui')),
  auth_version    bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX devices_user_idx ON identity.devices (user_id, revoked_at);
CREATE INDEX devices_push_token_idx ON identity.devices (push_token)
  WHERE push_token IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE identity.refresh_tokens (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL REFERENCES identity.devices(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,
  replaced_by_id  uuid REFERENCES identity.refresh_tokens(id) ON DELETE SET NULL,
  token_hash      text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  expires_at      timestamptz NOT NULL,
  rotated_at      timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON identity.refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON identity.refresh_tokens (user_id, expires_at);

CREATE TABLE identity.user_settings (
  user_id                 uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  theme                   text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  accent                  text NOT NULL DEFAULT 'coral' CHECK (accent IN ('coral', 'teal', 'amber', 'indigo')),
  week_start              text NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday')),
  default_list_id         uuid,
  default_reminder_time   time NOT NULL DEFAULT '09:00',
  time_format             text NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h', '24h')),
  quiet_hours_start       time,
  quiet_hours_end         time,
  notification_prefs      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(notification_prefs) = 'object'),
  version                 bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);


-- =============================================================================
-- todo
-- =============================================================================

CREATE TABLE todo.lists (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  color           text NOT NULL DEFAULT 'coral' CHECK (char_length(color) BETWEEN 1 AND 32),
  icon            text NOT NULL DEFAULT 'list' CHECK (char_length(icon) BETWEEN 1 AND 32),
  sort_rank       text NOT NULL CHECK (char_length(sort_rank) BETWEEN 1 AND 128),
  is_archived     boolean NOT NULL DEFAULT false,
  is_default      boolean NOT NULL DEFAULT false,
  version         bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT lists_user_id_id_key UNIQUE (user_id, id)
);

CREATE INDEX lists_user_sort_idx ON todo.lists (user_id, sort_rank)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX lists_one_default
  ON todo.lists (user_id)
  WHERE is_default AND deleted_at IS NULL;
CREATE UNIQUE INDEX lists_name_active
  ON todo.lists (user_id, lower(name))
  WHERE deleted_at IS NULL;

ALTER TABLE identity.user_settings
  ADD CONSTRAINT user_settings_default_list_fk
  FOREIGN KEY (user_id, default_list_id)
  REFERENCES todo.lists (user_id, id)
  ON DELETE SET NULL;

CREATE TABLE todo.tags (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  color           text NOT NULL DEFAULT 'slate' CHECK (char_length(color) BETWEEN 1 AND 32),
  version         bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT tags_user_id_id_key UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX tags_name_active
  ON todo.tags (user_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TABLE todo.tasks (
  id                          uuid PRIMARY KEY,
  user_id                     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  list_id                     uuid NOT NULL,
  parent_id                   uuid,
  title                       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  notes                       text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
  priority                    smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  due_date                    date,
  due_at                      timestamptz,
  completed_at                timestamptz,
  last_completed_at           timestamptz,
  recurrence_rule             text CHECK (recurrence_rule IS NULL OR char_length(recurrence_rule) <= 512),
  recurrence_dtstart          timestamptz,
  recurrence_until            date,
  recurrence_count_remaining  smallint CHECK (recurrence_count_remaining >= 0),
  recurrence_seq              integer NOT NULL DEFAULT 0 CHECK (recurrence_seq >= 0),
  recurrence_timezone         text,
  reminder_spec               jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_rank                   text NOT NULL CHECK (char_length(sort_rank) BETWEEN 1 AND 128),
  version                     bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz,
  CONSTRAINT tasks_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT due_at_most_one CHECK (num_nonnulls(due_date, due_at) <= 1),
  CONSTRAINT parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT reminder_spec_is_array CHECK (jsonb_typeof(reminder_spec) = 'array'),
  CONSTRAINT recurrence_requires_anchor CHECK (
    recurrence_rule IS NULL
    OR (recurrence_dtstart IS NOT NULL AND recurrence_timezone IS NOT NULL)
  )
);

ALTER TABLE todo.tasks
  ADD CONSTRAINT tasks_list_fk
  FOREIGN KEY (user_id, list_id)
  REFERENCES todo.lists (user_id, id)
  ON DELETE RESTRICT;

ALTER TABLE todo.tasks
  ADD CONSTRAINT tasks_parent_fk
  FOREIGN KEY (user_id, parent_id)
  REFERENCES todo.tasks (user_id, id)
  ON DELETE CASCADE;

CREATE INDEX tasks_open_by_list
  ON todo.tasks (user_id, list_id, sort_rank)
  WHERE deleted_at IS NULL AND completed_at IS NULL;
CREATE INDEX tasks_due_at
  ON todo.tasks (user_id, due_at)
  WHERE deleted_at IS NULL AND completed_at IS NULL;
CREATE INDEX tasks_due_date
  ON todo.tasks (user_id, due_date)
  WHERE deleted_at IS NULL AND completed_at IS NULL;
CREATE INDEX tasks_completed
  ON todo.tasks (user_id, completed_at)
  WHERE deleted_at IS NULL AND completed_at IS NOT NULL;
CREATE INDEX tasks_parent
  ON todo.tasks (user_id, parent_id)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX tasks_title_trgm
  ON todo.tasks USING gin (title gin_trgm_ops);

CREATE TABLE todo.task_tags (
  user_id     uuid NOT NULL,
  task_id     uuid NOT NULL,
  tag_id      uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, tag_id),
  FOREIGN KEY (user_id, task_id) REFERENCES todo.tasks (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tag_id) REFERENCES todo.tags (user_id, id) ON DELETE CASCADE
);

CREATE INDEX task_tags_tag_idx ON todo.task_tags (user_id, tag_id);

-- 重复任务完成台账：服务端专用，不参与客户端同步。
CREATE TABLE todo.task_completions (
  id                          uuid PRIMARY KEY,
  user_id                     uuid NOT NULL,
  task_id                     uuid NOT NULL,
  occurrence_key              text NOT NULL CHECK (char_length(occurrence_key) BETWEEN 1 AND 128),
  occurrence_due_at           timestamptz,
  occurrence_due_date         date,
  completed_at                timestamptz NOT NULL,
  device_id                   uuid,
  previous_due_at             timestamptz,
  previous_due_date           date,
  previous_count_remaining    smallint,
  previous_seq                integer,
  previous_last_completed_at  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, occurrence_key),
  FOREIGN KEY (user_id, task_id) REFERENCES todo.tasks (user_id, id) ON DELETE CASCADE
);

CREATE INDEX task_completions_stats
  ON todo.task_completions (user_id, completed_at);

CREATE TABLE todo.attachments (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  task_id         uuid NOT NULL,
  storage_key     text NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 512),
  filename        text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  mime            text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size            bigint NOT NULL CHECK (size > 0 AND size <= 20971520),
  checksum        text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  FOREIGN KEY (user_id, task_id) REFERENCES todo.tasks (user_id, id) ON DELETE CASCADE
);

CREATE INDEX attachments_task_idx ON todo.attachments (task_id)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- notify
-- =============================================================================

CREATE TABLE notify.reminders (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  task_id         uuid NOT NULL,
  reminder_key    text NOT NULL CHECK (char_length(reminder_key) BETWEEN 1 AND 64),
  occurrence_key  text NOT NULL CHECK (char_length(occurrence_key) BETWEEN 1 AND 128),
  remind_at       timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'canceled', 'expired')),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  attempt_count   smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, occurrence_key, reminder_key, remind_at),
  FOREIGN KEY (user_id, task_id) REFERENCES todo.tasks (user_id, id) ON DELETE CASCADE
);

CREATE INDEX reminders_pending
  ON notify.reminders (remind_at)
  WHERE status = 'pending';
CREATE INDEX reminders_processing
  ON notify.reminders (claimed_at)
  WHERE status = 'processing';

-- =============================================================================
-- sync
-- =============================================================================

CREATE TABLE sync.user_sync_state (
  user_id     uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  current_seq bigint NOT NULL DEFAULT 0 CHECK (current_seq >= 0)
);

CREATE TABLE sync.change_log (
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  seq             bigint NOT NULL CHECK (seq > 0),
  entity_type     text NOT NULL CHECK (entity_type IN ('task', 'list', 'tag')),
  entity_id       uuid NOT NULL,
  entity_version  bigint NOT NULL CHECK (entity_version > 0),
  op              text NOT NULL CHECK (op IN ('upsert', 'delete')),
  changed_fields  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changed_fields) = 'object'),
  device_id       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, seq)
);

CREATE INDEX change_log_entity
  ON sync.change_log (user_id, entity_type, entity_id, entity_version);
CREATE INDEX change_log_created
  ON sync.change_log (created_at);

CREATE TABLE sync.processed_ops (
  user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  op_id       uuid NOT NULL,
  result      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, op_id)
);

CREATE INDEX processed_ops_created ON sync.processed_ops (created_at);

-- =============================================================================
-- ops
-- =============================================================================

CREATE TABLE ops.export_jobs (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'expired')),
  format          text NOT NULL CHECK (format IN ('json', 'csv')),
  storage_key     text,
  error           text,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX export_jobs_user_idx ON ops.export_jobs (user_id, created_at);

CREATE TABLE ops.audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  event       text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 64),
  ip_hash     text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_user_idx ON ops.audit_log (user_id, created_at);

-- =============================================================================
-- 函数与触发器
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync.lock_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
END;
$$;

-- 每用户单调递增的变更序号；同时获取用户级事务锁，保证 seq 顺序与提交顺序一致。
CREATE OR REPLACE FUNCTION sync.next_seq(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  INSERT INTO sync.user_sync_state (user_id, current_seq)
  VALUES (p_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET current_seq = sync.user_sync_state.current_seq + 1
  RETURNING current_seq INTO v_seq;

  RETURN v_seq;
END;
$$;

-- 追加变更日志；调用方必须在同一事务内已完成实体写入。
CREATE OR REPLACE FUNCTION sync.append_change(
  p_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_version bigint,
  p_op text,
  p_changed_fields jsonb,
  p_device_id uuid
)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_seq bigint;
BEGIN
  v_seq := sync.next_seq(p_user_id);

  INSERT INTO sync.change_log (
    user_id, seq, entity_type, entity_id, entity_version, op, changed_fields, device_id
  ) VALUES (
    p_user_id, v_seq, p_entity_type, p_entity_id, p_entity_version, p_op,
    COALESCE(p_changed_fields, '{}'::jsonb), p_device_id
  );

  RETURN v_seq;
END;
$$;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER devices_set_updated_at
  BEFORE UPDATE ON identity.devices
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER user_settings_set_updated_at
  BEFORE UPDATE ON identity.user_settings
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER lists_set_updated_at
  BEFORE UPDATE ON todo.lists
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER tags_set_updated_at
  BEFORE UPDATE ON todo.tags
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON todo.tasks
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER export_jobs_set_updated_at
  BEFORE UPDATE ON ops.export_jobs
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

COMMENT ON SCHEMA identity IS '用户、身份、设备、会话与设置';
COMMENT ON SCHEMA todo IS '清单、任务、标签、完成台账与附件元数据';
COMMENT ON SCHEMA notify IS '提醒物化与调度状态';
COMMENT ON SCHEMA sync IS '增量同步序号、变更日志与幂等记录';
COMMENT ON SCHEMA ops IS '导出、审计与运维';

COMMENT ON TABLE sync.change_log IS '每用户 30 天变更日志；客户端按 (user_id, seq) 增量拉取';
COMMENT ON TABLE todo.task_completions IS '重复任务完成台账；用于幂等、撤销与 P2 统计';
COMMENT ON TABLE notify.reminders IS '服务端提醒队列；worker 以 UPDATE ... RETURNING 原子领取';

COMMIT;
