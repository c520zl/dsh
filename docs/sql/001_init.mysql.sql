-- Todo App — MySQL 8.0.16+ baseline (Spring Boot backend)
-- Kept in sync with backend/src/main/resources/db/migration/V1/V2.

-- Todo App — MySQL 8.0.16+ baseline (Spring Boot backend)
-- IDs are application-generated UUIDv7 strings; timestamps are UTC DATETIME(3).

CREATE TABLE identity_users (
  id              CHAR(36)     NOT NULL,
  email           VARCHAR(254) NOT NULL,
  display_name    VARCHAR(50)  NOT NULL,
  avatar          VARCHAR(255) NULL,
  timezone        VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  locale          VARCHAR(10)  NOT NULL DEFAULT 'zh-CN',
  auth_version    BIGINT       NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)  NULL,
  active_email    VARCHAR(254) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN email ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_active_email (active_email),
  KEY idx_users_email (email),
  CONSTRAINT chk_users_display_name CHECK (CHAR_LENGTH(TRIM(display_name)) BETWEEN 1 AND 50),
  CONSTRAINT chk_users_locale CHECK (locale IN ('zh-CN', 'en')),
  CONSTRAINT chk_users_auth_version CHECK (auth_version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE identity_auth_identities (
  id                CHAR(36)     NOT NULL,
  user_id           CHAR(36)     NOT NULL,
  provider          VARCHAR(16)  NOT NULL,
  provider_user_id  VARCHAR(255) NOT NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_identities_provider (provider, provider_user_id),
  KEY idx_auth_identities_user (user_id),
  CONSTRAINT fk_auth_identities_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_auth_identities_provider CHECK (provider IN ('apple', 'google', 'email')),
  CONSTRAINT chk_auth_identities_provider_id CHECK (CHAR_LENGTH(provider_user_id) BETWEEN 1 AND 255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE identity_devices (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  name            VARCHAR(100) NOT NULL,
  platform        VARCHAR(16)  NOT NULL,
  app_version     VARCHAR(32)  NULL,
  os_version      VARCHAR(32)  NULL,
  push_token      VARCHAR(512) NULL,
  push_provider   VARCHAR(16)  NULL,
  auth_version    BIGINT       NOT NULL DEFAULT 1,
  last_seen_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at      DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_devices_user (user_id, revoked_at),
  KEY idx_devices_push_token (push_token),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_devices_platform CHECK (platform IN ('ios', 'android', 'web')),
  CONSTRAINT chk_devices_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 100),
  CONSTRAINT chk_devices_push_provider CHECK (push_provider IS NULL OR push_provider IN
    ('apns', 'fcm', 'expo', 'huawei', 'xiaomi', 'oppo', 'vivo', 'jpush', 'getui'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE identity_refresh_tokens (
  id              CHAR(36)    NOT NULL,
  user_id         CHAR(36)    NOT NULL,
  device_id       CHAR(36)    NOT NULL,
  family_id       CHAR(36)    NOT NULL,
  replaced_by_id  CHAR(36)    NULL,
  token_hash      CHAR(64)    NOT NULL,
  expires_at      DATETIME(3) NOT NULL,
  rotated_at      DATETIME(3) NULL,
  revoked_at      DATETIME(3) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_family (family_id),
  KEY idx_refresh_tokens_user (user_id, expires_at),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_device FOREIGN KEY (device_id) REFERENCES identity_devices (id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_replaced FOREIGN KEY (replaced_by_id) REFERENCES identity_refresh_tokens (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- OTP code and rate-limit persistence replaces the previous Redis dependency.
CREATE TABLE identity_otp_codes (
  email         VARCHAR(254) NOT NULL,
  code_hash     CHAR(64)     NOT NULL,
  attempts      INT          NOT NULL DEFAULT 0,
  expires_at    DATETIME(3)  NOT NULL,
  last_sent_at  DATETIME(3)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE identity_auth_rate_limits (
  bucket        VARCHAR(200) NOT NULL,
  window_start  DATETIME(3)  NOT NULL,
  counter       INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE todo_lists (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  name            VARCHAR(50)  NOT NULL,
  color           VARCHAR(32)  NOT NULL DEFAULT 'coral',
  icon            VARCHAR(32)  NOT NULL DEFAULT 'list',
  sort_rank       VARCHAR(128) NOT NULL,
  is_archived     TINYINT(1)   NOT NULL DEFAULT 0,
  is_default      TINYINT(1)   NOT NULL DEFAULT 0,
  version         BIGINT       NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)  NULL,
  active_name     VARCHAR(50)  GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN name ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lists_user_id_id (user_id, id),
  UNIQUE KEY uq_lists_active_name (user_id, active_name),
  KEY idx_lists_user_sort (user_id, sort_rank),
  CONSTRAINT fk_lists_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_lists_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 50),
  CONSTRAINT chk_lists_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE identity_user_settings (
  user_id                 CHAR(36)    NOT NULL,
  theme                   VARCHAR(16) NOT NULL DEFAULT 'system',
  accent                  VARCHAR(16) NOT NULL DEFAULT 'coral',
  week_start              VARCHAR(10) NOT NULL DEFAULT 'monday',
  default_list_id         CHAR(36)    NULL,
  default_reminder_time   TIME        NOT NULL DEFAULT '09:00:00',
  time_format             VARCHAR(4)  NOT NULL DEFAULT '24h',
  quiet_hours_start       TIME        NULL,
  quiet_hours_end         TIME        NULL,
  notification_prefs      JSON        NOT NULL,
  version                 BIGINT      NOT NULL DEFAULT 1,
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY idx_settings_default_list (default_list_id),
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_settings_theme CHECK (theme IN ('system', 'light', 'dark')),
  CONSTRAINT chk_settings_accent CHECK (accent IN ('coral', 'teal', 'amber', 'indigo')),
  CONSTRAINT chk_settings_week_start CHECK (week_start IN ('monday', 'sunday')),
  CONSTRAINT chk_settings_time_format CHECK (time_format IN ('12h', '24h')),
  CONSTRAINT chk_settings_quiet_pair CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)),
  CONSTRAINT chk_settings_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE todo_tags (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  name            VARCHAR(30)  NOT NULL,
  color           VARCHAR(32)  NOT NULL DEFAULT 'slate',
  version         BIGINT       NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)  NULL,
  active_name     VARCHAR(30)  GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN name ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_user_id_id (user_id, id),
  UNIQUE KEY uq_tags_active_name (user_id, active_name),
  CONSTRAINT fk_tags_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_tags_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 30),
  CONSTRAINT chk_tags_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE todo_tasks (
  id                          CHAR(36)     NOT NULL,
  user_id                     CHAR(36)     NOT NULL,
  list_id                     CHAR(36)     NOT NULL,
  parent_id                   CHAR(36)     NULL,
  title                       VARCHAR(500) NOT NULL,
  notes                       TEXT         NOT NULL,
  priority                    SMALLINT     NOT NULL DEFAULT 0,
  due_date                    DATE         NULL,
  due_at                      DATETIME(3)  NULL,
  completed_at                DATETIME(3)  NULL,
  last_completed_at           DATETIME(3)  NULL,
  recurrence_rule             VARCHAR(512) NULL,
  recurrence_dtstart          DATETIME(3)  NULL,
  recurrence_until            DATE         NULL,
  recurrence_count_remaining  SMALLINT     NULL,
  recurrence_seq              INT          NOT NULL DEFAULT 0,
  recurrence_timezone         VARCHAR(64)  NULL,
  reminder_spec               JSON         NOT NULL,
  sort_rank                   VARCHAR(128) NOT NULL,
  version                     BIGINT       NOT NULL DEFAULT 1,
  created_at                  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at                  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tasks_user_id_id (user_id, id),
  KEY idx_tasks_user_list_sort (user_id, list_id, sort_rank),
  KEY idx_tasks_user_due_at (user_id, due_at),
  KEY idx_tasks_user_due_date (user_id, due_date),
  KEY idx_tasks_user_completed (user_id, completed_at),
  KEY idx_tasks_user_parent (user_id, parent_id),
  KEY idx_tasks_user_updated (user_id, updated_at),
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_list FOREIGN KEY (user_id, list_id) REFERENCES todo_lists (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tasks_parent FOREIGN KEY (user_id, parent_id) REFERENCES todo_tasks (user_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_tasks_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 500),
  CONSTRAINT chk_tasks_priority CHECK (priority BETWEEN 0 AND 3),
  CONSTRAINT chk_tasks_due_exclusive CHECK (due_date IS NULL OR due_at IS NULL),
  CONSTRAINT chk_tasks_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT chk_tasks_recurrence CHECK (recurrence_rule IS NULL OR (recurrence_dtstart IS NOT NULL AND recurrence_timezone IS NOT NULL)),
  CONSTRAINT chk_tasks_recurrence_count CHECK (recurrence_count_remaining IS NULL OR recurrence_count_remaining >= 0),
  CONSTRAINT chk_tasks_recurrence_seq CHECK (recurrence_seq >= 0),
  CONSTRAINT chk_tasks_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE todo_task_tags (
  user_id     CHAR(36)    NOT NULL,
  task_id     CHAR(36)    NOT NULL,
  tag_id      CHAR(36)    NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (task_id, tag_id),
  KEY idx_task_tags_tag (user_id, tag_id),
  CONSTRAINT fk_task_tags_task FOREIGN KEY (user_id, task_id) REFERENCES todo_tasks (user_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_task_tags_tag FOREIGN KEY (user_id, tag_id) REFERENCES todo_tags (user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE todo_task_completions (
  id                          CHAR(36)    NOT NULL,
  user_id                     CHAR(36)    NOT NULL,
  task_id                     CHAR(36)    NOT NULL,
  occurrence_key              VARCHAR(128) NOT NULL,
  occurrence_due_at           DATETIME(3) NULL,
  occurrence_due_date         DATE        NULL,
  completed_at                DATETIME(3) NOT NULL,
  device_id                   CHAR(36)    NULL,
  previous_due_at             DATETIME(3) NULL,
  previous_due_date           DATE        NULL,
  previous_count_remaining    SMALLINT    NULL,
  previous_seq                INT         NULL,
  previous_last_completed_at  DATETIME(3) NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_task_completions_occurrence (task_id, occurrence_key),
  KEY idx_task_completions_stats (user_id, completed_at),
  CONSTRAINT fk_task_completions_task FOREIGN KEY (user_id, task_id) REFERENCES todo_tasks (user_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_task_completions_key CHECK (CHAR_LENGTH(occurrence_key) BETWEEN 1 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE todo_attachments (
  id           CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  task_id      CHAR(36)     NOT NULL,
  storage_key  VARCHAR(512) NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  mime         VARCHAR(64)  NOT NULL,
  size         BIGINT       NOT NULL,
  checksum     CHAR(64)     NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attachments_storage_key (storage_key),
  KEY idx_attachments_task (task_id),
  CONSTRAINT fk_attachments_task FOREIGN KEY (user_id, task_id) REFERENCES todo_tasks (user_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_attachments_mime CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT chk_attachments_size CHECK (size > 0 AND size <= 20971520),
  CONSTRAINT chk_attachments_checksum CHECK (checksum REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notify_reminders (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  task_id         CHAR(36)     NOT NULL,
  reminder_key    VARCHAR(64)  NOT NULL,
  occurrence_key  VARCHAR(128) NOT NULL,
  remind_at       DATETIME(3)  NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
  claimed_at      DATETIME(3)  NULL,
  sent_at         DATETIME(3)  NULL,
  attempt_count   SMALLINT     NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reminders_identity (task_id, occurrence_key, reminder_key, remind_at),
  KEY idx_reminders_pending (status, remind_at),
  KEY idx_reminders_processing (status, claimed_at),
  CONSTRAINT fk_reminders_task FOREIGN KEY (user_id, task_id) REFERENCES todo_tasks (user_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_reminders_status CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'canceled', 'expired')),
  CONSTRAINT chk_reminders_attempt CHECK (attempt_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_user_sync_state (
  user_id      CHAR(36) NOT NULL,
  current_seq  BIGINT   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_sync_state_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_sync_state_seq CHECK (current_seq >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_change_log (
  user_id         CHAR(36)     NOT NULL,
  seq             BIGINT       NOT NULL,
  entity_type     VARCHAR(8)   NOT NULL,
  entity_id       CHAR(36)     NOT NULL,
  entity_version  BIGINT       NOT NULL,
  op              VARCHAR(8)   NOT NULL,
  changed_fields  JSON         NOT NULL,
  device_id       CHAR(36)     NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, seq),
  KEY idx_change_log_entity (user_id, entity_type, entity_id, entity_version),
  KEY idx_change_log_created (created_at),
  CONSTRAINT fk_change_log_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_change_log_entity CHECK (entity_type IN ('task', 'list', 'tag')),
  CONSTRAINT chk_change_log_op CHECK (op IN ('upsert', 'delete'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_processed_ops (
  user_id     CHAR(36)    NOT NULL,
  op_id       CHAR(36)    NOT NULL,
  result      JSON        NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, op_id),
  KEY idx_processed_ops_created (created_at),
  CONSTRAINT fk_processed_ops_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ops_export_jobs (
  id           CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
  file_format  VARCHAR(8)   NOT NULL,
  storage_key  VARCHAR(255) NULL,
  error        VARCHAR(500) NULL,
  expires_at   DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_export_jobs_user (user_id, created_at),
  KEY idx_export_jobs_status (status, created_at),
  CONSTRAINT fk_export_jobs_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE,
  CONSTRAINT chk_export_jobs_status CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'expired')),
  CONSTRAINT chk_export_jobs_format CHECK (file_format IN ('json', 'csv'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ops_audit_log (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     CHAR(36)     NULL,
  event       VARCHAR(64)  NOT NULL,
  ip_hash     CHAR(64)     NULL,
  metadata    JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_log_user (user_id, created_at),
  KEY idx_audit_log_created (created_at),
  CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE SET NULL,
  CONSTRAINT chk_audit_log_event CHECK (CHAR_LENGTH(event) BETWEEN 1 AND 64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE identity_idempotency_keys (
  user_id         CHAR(36)     NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  response        JSON         NOT NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, idempotency_key),
  KEY idx_idempotency_created (created_at),
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES identity_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
