package com.todoapp.export;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.auth.AuditService;
import com.todoapp.auth.User;
import com.todoapp.common.ApiException;
import com.todoapp.common.Ids;
import com.todoapp.common.TimeUtils;
import com.todoapp.config.AppProperties;
import com.todoapp.list.TodoList;
import com.todoapp.mapper.ExportMapper;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.ListMapper;
import com.todoapp.mapper.ReminderMapper;
import com.todoapp.mapper.TagMapper;
import com.todoapp.mapper.TaskMapper;
import com.todoapp.reminder.Reminder;
import com.todoapp.tag.Tag;
import com.todoapp.task.Task;
import com.todoapp.task.TaskTagLink;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ExportService {
  private static final Logger log = LoggerFactory.getLogger(ExportService.class);
  private final ExportMapper exportMapper;
  private final IdentityMapper identityMapper;
  private final ListMapper listMapper;
  private final TagMapper tagMapper;
  private final TaskMapper taskMapper;
  private final ReminderMapper reminderMapper;
  private final AuditService audit;
  private final AppProperties properties;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate transactionTemplate;

  public ExportService(
      ExportMapper exportMapper,
      IdentityMapper identityMapper,
      ListMapper listMapper,
      TagMapper tagMapper,
      TaskMapper taskMapper,
      ReminderMapper reminderMapper,
      AuditService audit,
      AppProperties properties,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager) {
    this.exportMapper = exportMapper;
    this.identityMapper = identityMapper;
    this.listMapper = listMapper;
    this.tagMapper = tagMapper;
    this.taskMapper = taskMapper;
    this.reminderMapper = reminderMapper;
    this.audit = audit;
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.transactionTemplate = new TransactionTemplate(transactionManager);
  }

  public ExportDtos.ExportJobDto create(String userId, String format, String ip) {
    ExportJob job = new ExportJob();
    job.setId(Ids.uuidv7());
    job.setUserId(userId);
    job.setStatus("pending");
    job.setFileFormat(format);
    exportMapper.insertJob(job);
    audit.record(userId, "export_requested", ip, Map.of("format", format));
    return ExportDtos.ExportJobDto.from(exportMapper.selectJob(userId, job.getId()), properties.getExport().getPublicBaseUrl());
  }

  public ExportDtos.ExportJobDto get(String userId, String exportId) {
    ExportJob job = exportMapper.selectJob(userId, Ids.requireUuid(exportId, "exportId"));
    if (job == null) {
      throw ApiException.notFound("导出任务不存在");
    }
    if ("ready".equals(job.getStatus())
        && job.getExpiresAt() != null
        && !job.getExpiresAt().isAfter(TimeUtils.nowUtc())) {
      exportMapper.markExpired(job.getId());
      job.setStatus("expired");
    }
    return ExportDtos.ExportJobDto.from(job, properties.getExport().getPublicBaseUrl());
  }

  public record Download(Resource resource, String filename, String contentType) {}

  public Download download(String userId, String exportId) {
    ExportJob job = exportMapper.selectJob(userId, Ids.requireUuid(exportId, "exportId"));
    if (job == null || !"ready".equals(job.getStatus()) || job.getStorageKey() == null) {
      throw ApiException.notFound("导出文件不存在或尚未生成");
    }
    if (job.getExpiresAt() == null || !job.getExpiresAt().isAfter(TimeUtils.nowUtc())) {
      exportMapper.markExpired(job.getId());
      throw ApiException.notFound("导出文件已过期");
    }
    Path root = Path.of(properties.getExport().getStorageDir()).toAbsolutePath().normalize();
    Path file = root.resolve(job.getStorageKey()).normalize();
    if (!file.startsWith(root) || !Files.exists(file)) {
      throw ApiException.notFound("导出文件不存在");
    }
    String mime = "json".equals(job.getFileFormat()) ? "application/json" : "text/csv; charset=utf-8";
    return new Download(new FileSystemResource(file), "todo-export-" + job.getId() + "." + job.getFileFormat(), mime);
  }

  public int processPending(int limit) {
    List<ExportJob> jobs =
        transactionTemplate.execute(
            status -> {
              List<ExportJob> selected = exportMapper.selectPending(limit);
              for (ExportJob job : selected) {
                exportMapper.markProcessing(job.getId());
              }
              return selected;
            });
    if (jobs == null) {
      return 0;
    }
    for (ExportJob job : jobs) {
      processOne(job);
    }
    return jobs.size();
  }

  private void processOne(ExportJob job) {
    try {
      String content = "csv".equals(job.getFileFormat()) ? buildCsv(job.getUserId()) : buildJson(job.getUserId());
      Path root = Path.of(properties.getExport().getStorageDir()).toAbsolutePath().normalize();
      Files.createDirectories(root);
      String storageKey = job.getId() + "." + job.getFileFormat();
      Files.writeString(root.resolve(storageKey), content, StandardCharsets.UTF_8);
      exportMapper.markReady(
          job.getId(),
          storageKey,
          TimeUtils.nowUtc().plusHours(properties.getExport().getTtlHours()));
    } catch (Exception error) {
      log.error("Failed to generate export {}", job.getId(), error);
      exportMapper.markFailed(job.getId(), (error.getMessage() == null ? "export failed" : error.getMessage()));
    }
  }

  private String buildJson(String userId) throws IOException {
    User user = identityMapper.selectUserById(userId);
    if (user == null) {
      throw new IllegalStateException("User not found");
    }
    var settings = identityMapper.selectSettings(userId);
    List<TodoList> lists = listMapper.selectLists(userId, true);
    List<Tag> tags = tagMapper.selectTags(userId);
    List<Task> tasks = taskMapper.selectTasksForExport(userId);
    List<Reminder> reminders = reminderMapper.selectForUser(userId);
    Map<String, List<String>> tagMap = new LinkedHashMap<>();
    if (!tasks.isEmpty()) {
      for (TaskTagLink link : taskMapper.selectTagLinks(userId, tasks.stream().map(Task::getId).toList())) {
        tagMap.computeIfAbsent(link.getTaskId(), ignored -> new ArrayList<>()).add(link.getTagId());
      }
    }
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("exportedAt", TimeUtils.iso(TimeUtils.nowUtc()));
    payload.put("user", mapOf(
        "id", user.getId(), "email", user.getEmail(), "displayName", user.getDisplayName(),
        "avatar", user.getAvatar(), "timezone", user.getTimezone(), "locale", user.getLocale(),
        "createdAt", user.getCreatedAt() == null ? null : TimeUtils.iso(user.getCreatedAt()),
        "deletedAt", user.getDeletedAt() == null ? null : TimeUtils.iso(user.getDeletedAt())));
    payload.put("settings", settings == null ? null : mapOf(
        "theme", settings.getTheme(), "accent", settings.getAccent(), "weekStart", settings.getWeekStart(),
        "defaultListId", settings.getDefaultListId(),
        "defaultReminderTime", settings.getDefaultReminderTime() == null ? null : settings.getDefaultReminderTime().toString(),
        "timeFormat", settings.getTimeFormat(),
        "quietHoursStart", settings.getQuietHoursStart() == null ? null : settings.getQuietHoursStart().toString(),
        "quietHoursEnd", settings.getQuietHoursEnd() == null ? null : settings.getQuietHoursEnd().toString(),
        "notificationPrefs", settings.getNotificationPrefs(), "version", settings.getVersion()));
    payload.put("lists", lists.stream().map(this::listMap).toList());
    payload.put("tags", tags.stream().map(this::tagMap).toList());
    payload.put("tasks", tasks.stream().map(task -> taskMap(task, tagMap.getOrDefault(task.getId(), List.of()))).toList());
    payload.put("reminders", reminders.stream().map(this::reminderMap).toList());
    payload.put("attachments", List.of());
    return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(payload) + "\n";
  }

  private String buildCsv(String userId) {
    List<Task> tasks = taskMapper.selectTasksForExport(userId);
    List<String> lines = new ArrayList<>();
    lines.add("id,listId,parentId,title,notes,priority,dueDate,dueAt,completedAt,lastCompletedAt,"
        + "recurrenceRule,recurrenceUntil,recurrenceCountRemaining,recurrenceSeq,recurrenceTimezone,"
        + "sortRank,version,createdAt,updatedAt,deletedAt");
    for (Task task : tasks) {
      lines.add(
          String.join(",",
              List.of(
                  cell(task.getId()), cell(task.getListId()), cell(task.getParentId()), cell(task.getTitle()),
                  cell(task.getNotes()), cell(task.getPriority()), cell(task.getDueDate()),
                  cell(task.getDueAt() == null ? null : TimeUtils.iso(task.getDueAt())),
                  cell(task.getCompletedAt() == null ? null : TimeUtils.iso(task.getCompletedAt())),
                  cell(task.getLastCompletedAt() == null ? null : TimeUtils.iso(task.getLastCompletedAt())),
                  cell(task.getRecurrenceRule()), cell(task.getRecurrenceUntil()),
                  cell(task.getRecurrenceCountRemaining()), cell(task.getRecurrenceSeq()),
                  cell(task.getRecurrenceTimezone()), cell(task.getSortRank()), cell(task.getVersion()),
                  cell(task.getCreatedAt() == null ? null : TimeUtils.iso(task.getCreatedAt())),
                  cell(task.getUpdatedAt() == null ? null : TimeUtils.iso(task.getUpdatedAt())),
                  cell(task.getDeletedAt() == null ? null : TimeUtils.iso(task.getDeletedAt())))));
    }
    return String.join("\n", lines) + "\n";
  }

  public int resetStale() {
    return exportMapper.resetStaleProcessing(TimeUtils.nowUtc().minusMinutes(10));
  }

  public int purgeOld() {
    LocalDateTime cutoff = TimeUtils.nowUtc().minusDays(7);
    List<ExportJob> old = exportMapper.selectExpired(cutoff);
    for (ExportJob job : old) {
      if (job.getStorageKey() == null) {
        continue;
      }
      try {
        Path root = Path.of(properties.getExport().getStorageDir()).toAbsolutePath().normalize();
        Path file = root.resolve(job.getStorageKey()).normalize();
        if (file.startsWith(root)) {
          Files.deleteIfExists(file);
        }
      } catch (IOException error) {
        log.warn("Failed to remove export file {}", job.getStorageKey(), error);
      }
    }
    return exportMapper.deleteOld(cutoff);
  }

  private Map<String, Object> taskMap(Task task, List<String> tagIds) {
    return mapOf(
        "id", task.getId(), "listId", task.getListId(), "parentId", task.getParentId(),
        "title", task.getTitle(), "notes", task.getNotes(), "priority", task.getPriority(),
        "dueDate", task.getDueDate() == null ? null : task.getDueDate().toString(),
        "dueAt", task.getDueAt() == null ? null : TimeUtils.iso(task.getDueAt()),
        "completedAt", task.getCompletedAt() == null ? null : TimeUtils.iso(task.getCompletedAt()),
        "lastCompletedAt", task.getLastCompletedAt() == null ? null : TimeUtils.iso(task.getLastCompletedAt()),
        "recurrenceRule", task.getRecurrenceRule(),
        "recurrenceDtstart", task.getRecurrenceDtstart() == null ? null : TimeUtils.iso(task.getRecurrenceDtstart()),
        "recurrenceUntil", task.getRecurrenceUntil() == null ? null : task.getRecurrenceUntil().toString(),
        "recurrenceCountRemaining", task.getRecurrenceCountRemaining(),
        "recurrenceSeq", task.getRecurrenceSeq(), "recurrenceTimezone", task.getRecurrenceTimezone(),
        "reminderSpec", parseJson(task.getReminderSpec()), "tagIds", tagIds,
        "sortRank", task.getSortRank(), "version", task.getVersion(),
        "createdAt", task.getCreatedAt() == null ? null : TimeUtils.iso(task.getCreatedAt()),
        "updatedAt", task.getUpdatedAt() == null ? null : TimeUtils.iso(task.getUpdatedAt()),
        "deletedAt", task.getDeletedAt() == null ? null : TimeUtils.iso(task.getDeletedAt()));
  }

  private Map<String, Object> listMap(TodoList list) {
    return mapOf(
        "id", list.getId(), "name", list.getName(), "color", list.getColor(), "icon", list.getIcon(),
        "sortRank", list.getSortRank(), "isArchived", list.getIsArchived(), "isDefault", list.getIsDefault(),
        "version", list.getVersion(),
        "createdAt", list.getCreatedAt() == null ? null : TimeUtils.iso(list.getCreatedAt()),
        "updatedAt", list.getUpdatedAt() == null ? null : TimeUtils.iso(list.getUpdatedAt()),
        "deletedAt", list.getDeletedAt() == null ? null : TimeUtils.iso(list.getDeletedAt()));
  }

  private Map<String, Object> tagMap(Tag tag) {
    return mapOf(
        "id", tag.getId(), "name", tag.getName(), "color", tag.getColor(), "version", tag.getVersion(),
        "createdAt", tag.getCreatedAt() == null ? null : TimeUtils.iso(tag.getCreatedAt()),
        "updatedAt", tag.getUpdatedAt() == null ? null : TimeUtils.iso(tag.getUpdatedAt()),
        "deletedAt", tag.getDeletedAt() == null ? null : TimeUtils.iso(tag.getDeletedAt()));
  }

  private Map<String, Object> reminderMap(Reminder reminder) {
    return mapOf(
        "id", reminder.getId(), "taskId", reminder.getTaskId(), "reminderKey", reminder.getReminderKey(),
        "occurrenceKey", reminder.getOccurrenceKey(),
        "remindAt", TimeUtils.iso(reminder.getRemindAt()), "status", reminder.getStatus(),
        "sentAt", reminder.getSentAt() == null ? null : TimeUtils.iso(reminder.getSentAt()));
  }

  private Object parseJson(String value) {
    if (value == null || value.isBlank()) {
      return List.of();
    }
    try {
      return objectMapper.readValue(value, new TypeReference<Object>() {});
    } catch (Exception error) {
      return value;
    }
  }

  private static Map<String, Object> mapOf(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i + 1 < pairs.length; i += 2) {
      map.put(String.valueOf(pairs[i]), pairs[i + 1]);
    }
    return map;
  }

  private static String cell(Object value) {
    if (value == null) {
      return "";
    }
    String text = value.toString();
    return text.matches(".*[\",\\n\\r].*") ? "\"" + text.replace("\"", "\"\"") + "\"" : text;
  }
}
