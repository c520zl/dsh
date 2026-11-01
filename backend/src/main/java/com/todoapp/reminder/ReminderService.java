package com.todoapp.reminder;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.auth.Device;
import com.todoapp.auth.User;
import com.todoapp.common.Ids;
import com.todoapp.common.TimeUtils;
import com.todoapp.config.AppProperties;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.ReminderMapper;
import com.todoapp.mapper.TaskMapper;
import com.todoapp.task.Task;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ReminderService {
  private static final Logger log = LoggerFactory.getLogger(ReminderService.class);
  private static final long DAY_MS = 24 * 60 * 60 * 1000L;

  public record ReminderSpec(String id, int offsetMinutes) {}

  public record LocalDelivery(String reminderId, String occurrenceKey, String deliveredAt) {}

  private final ReminderMapper reminderMapper;
  private final TaskMapper taskMapper;
  private final IdentityMapper identityMapper;
  private final PushService pushService;
  private final AppProperties properties;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate transactionTemplate;

  public ReminderService(
      ReminderMapper reminderMapper,
      TaskMapper taskMapper,
      IdentityMapper identityMapper,
      PushService pushService,
      AppProperties properties,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager) {
    this.reminderMapper = reminderMapper;
    this.taskMapper = taskMapper;
    this.identityMapper = identityMapper;
    this.pushService = pushService;
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.transactionTemplate = new TransactionTemplate(transactionManager);
  }

  public void cancelForTask(String userId, String taskId) {
    reminderMapper.cancelForTask(userId, taskId);
  }

  /** Rebuild current-occurrence reminders; must run in the task write transaction. */
  public void rebuildForTask(Task task) {
    reminderMapper.cancelForTask(task.getUserId(), task.getId());
    if (task.getDeletedAt() != null || task.getCompletedAt() != null) {
      return;
    }
    if (task.getDueDate() == null && task.getDueAt() == null) {
      return;
    }
    List<ReminderSpec> specs = parseSpecs(task.getReminderSpec());
    if (specs.isEmpty()) {
      return;
    }
    String occurrenceKey = TimeUtils.currentOccurrenceKey(task.getDueDate(), task.getDueAt());
    if (occurrenceKey == null) {
      return;
    }
    User user = identityMapper.selectUserById(task.getUserId());
    var settings = identityMapper.selectSettings(task.getUserId());
    if (user == null || settings == null) {
      return;
    }
    ZoneId zone = TimeUtils.zone(user.getTimezone());
    LocalTime baseTime = settings.getDefaultReminderTime();
    for (ReminderSpec spec : specs) {
      Instant base =
          task.getDueAt() != null
              ? TimeUtils.toInstant(task.getDueAt())
              : TimeUtils.zonedWallTimeToInstant(
                  zone, task.getDueDate(), baseTime.getHour(), baseTime.getMinute());
      Reminder reminder = new Reminder();
      reminder.setId(Ids.uuidv7());
      reminder.setUserId(task.getUserId());
      reminder.setTaskId(task.getId());
      reminder.setReminderKey(spec.id());
      reminder.setOccurrenceKey(occurrenceKey);
      reminder.setRemindAt(TimeUtils.fromInstant(TimeUtils.addMinutes(base, spec.offsetMinutes())));
      reminder.setStatus("pending");
      reminder.setAttemptCount(0);
      reminderMapper.upsertReminder(reminder);
    }
  }

  @Transactional
  public void rebuildForUser(String userId) {
    for (Task task : taskMapper.selectTasksWithReminders(userId)) {
      rebuildForTask(task);
    }
  }

  public void processLocalDeliveries(String userId, List<LocalDelivery> deliveries) {
    if (deliveries == null) {
      return;
    }
    for (LocalDelivery delivery : deliveries) {
      try {
        reminderMapper.markLocalDelivered(
            userId,
            delivery.reminderId(),
            delivery.occurrenceKey(),
            TimeUtils.fromInstant(TimeUtils.parseInstant(delivery.deliveredAt(), "deliveredAt")));
      } catch (RuntimeException error) {
        log.debug("Ignored invalid local delivery: {}", error.getMessage());
      }
    }
  }

  public int dispatchDue(int limit) {
    List<Reminder> due =
        transactionTemplate.execute(
            status -> {
              List<Reminder> selected = reminderMapper.selectDueForUpdate(TimeUtils.nowUtc(), limit);
              for (Reminder reminder : selected) {
                int attempt = (reminder.getAttemptCount() == null ? 0 : reminder.getAttemptCount()) + 1;
                reminderMapper.markProcessing(reminder.getId(), TimeUtils.nowUtc(), attempt);
                reminder.setAttemptCount(attempt);
              }
              return selected;
            });
    if (due == null) {
      return 0;
    }
    for (Reminder reminder : due) {
      try {
        dispatchOne(reminder);
      } catch (RuntimeException error) {
        log.error("Failed to dispatch reminder {}", reminder.getId(), error);
        reminderMapper.reschedule(reminder.getId(), "pending", reminder.getRemindAt(), null);
      }
    }
    return due.size();
  }

  private void dispatchOne(Reminder reminder) {
    Task task = taskMapper.selectTask(reminder.getUserId(), reminder.getTaskId());
    if (task == null || task.getDeletedAt() != null || task.getCompletedAt() != null) {
      reminderMapper.markStatus(reminder.getId(), "canceled", null);
      return;
    }
    if (task.getRecurrenceRule() != null) {
      String current = TimeUtils.currentOccurrenceKey(task.getDueDate(), task.getDueAt());
      if (!reminder.getOccurrenceKey().equals(current)) {
        reminderMapper.markStatus(reminder.getId(), "canceled", null);
        return;
      }
    }
    long delayedMs = System.currentTimeMillis() - TimeUtils.toInstant(reminder.getRemindAt()).toEpochMilli();
    if (delayedMs > DAY_MS) {
      reminderMapper.markStatus(reminder.getId(), "expired", null);
      return;
    }
    List<Device> devices = identityMapper.selectActiveDevices(reminder.getUserId());
    if (!properties.getPush().isEnabled()) {
      log.info("[push disabled] reminder={} task={}", reminder.getId(), task.getId());
      reminderMapper.markStatus(reminder.getId(), "sent", TimeUtils.nowUtc());
      return;
    }
    if (devices.isEmpty()) {
      reminderMapper.markStatus(reminder.getId(), "failed", null);
      return;
    }
    boolean delivered = false;
    for (Device device : devices) {
      if (device.getPushToken() == null) {
        continue;
      }
      delivered |=
          pushService.send(
              device,
              "待办提醒",
              task.getTitle(),
              Map.of(
                  "taskId", task.getId(),
                  "reminderId", reminder.getReminderKey(),
                  "occurrenceKey", reminder.getOccurrenceKey()));
    }
    if (delivered) {
      reminderMapper.markStatus(reminder.getId(), "sent", TimeUtils.nowUtc());
      return;
    }
    int attempts = reminder.getAttemptCount() == null ? 1 : reminder.getAttemptCount();
    if (attempts > 3) {
      reminderMapper.markStatus(reminder.getId(), "failed", null);
      return;
    }
    int minutes = switch (attempts) {
      case 1 -> 1;
      case 2 -> 5;
      default -> 15;
    };
    reminderMapper.reschedule(
        reminder.getId(),
        "pending",
        TimeUtils.fromInstant(TimeUtils.addMinutes(TimeUtils.toInstant(reminder.getRemindAt()), minutes)),
        null);
  }

  public int expireStale() {
    return reminderMapper.expireBefore(TimeUtils.nowUtc().minusHours(24));
  }

  public int resetStaleProcessing() {
    return reminderMapper.resetStaleProcessing(TimeUtils.nowUtc().minusMinutes(2));
  }

  public int purgeOld() {
    return reminderMapper.deleteOld(TimeUtils.nowUtc().minusDays(properties.getRetention().getReminderDays()));
  }

  private List<ReminderSpec> parseSpecs(String json) {
    if (json == null || json.isBlank()) {
      return List.of();
    }
    try {
      return objectMapper.readValue(json, new TypeReference<List<ReminderSpec>>() {});
    } catch (Exception error) {
      log.warn("Invalid reminder_spec JSON", error);
      return List.of();
    }
  }
}
