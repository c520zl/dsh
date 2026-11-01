package com.todoapp.task;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.todoapp.common.TimeUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import lombok.Data;

public final class TaskDtos {
  private TaskDtos() {}

  public record ReminderSpecDto(
      @NotBlank String id,
      @NotNull @Min(-10080) @Max(1440) Integer offsetMinutes) {}

  public record RecurrenceDto(
      String rule,
      String timezone,
      String dtstart,
      String until,
      Integer countRemaining,
      Integer seq) {}

  public record TaskDto(
      String id,
      String listId,
      String parentId,
      String title,
      String notes,
      int priority,
      String dueDate,
      String dueAt,
      String completedAt,
      String lastCompletedAt,
      List<ReminderSpecDto> reminderSpec,
      RecurrenceDto recurrence,
      List<String> tagIds,
      String sortRank,
      long version,
      String createdAt,
      String updatedAt,
      String deletedAt) {}

  public record TaskPage(List<TaskDto> items, String nextCursor, boolean hasMore) {}

  public record CompleteTaskResponse(TaskDto task, String status, String completionId) {}

  public record BatchResult(
      String taskId, String status, TaskDto task, ErrorResponse error) {}

  public record BatchResponse(List<BatchResult> results) {}

  public record ErrorResponse(ErrorBody error) {}

  public record ErrorBody(String code, String message, Object details, String requestId) {}

  @Data
  public static class RecurrenceInput {
    @NotBlank
    @Size(max = 512)
    private String rule;

    @NotBlank
    @Size(max = 64)
    private String timezone;

    @NotNull
    private Instant dtstart;

    private LocalDate until;

    @Min(0)
    private Integer countRemaining;

    @NotNull
    @Min(0)
    private Integer seq;
  }

  @Data
  public static class CreateTask {
    private String id;
    private String listId;
    private String parentId;

    @NotBlank
    @Size(max = 500)
    private String title;

    @Size(max = 10000)
    private String notes;

    @Min(0)
    @Max(3)
    private Integer priority;

    private LocalDate dueDate;
    private Instant dueAt;

    @Size(max = 5)
    @Valid
    private List<ReminderSpecDto> reminderSpec;

    @Valid
    private RecurrenceInput recurrence;

    @Size(max = 10)
    private List<String> tagIds;

    @Size(max = 128)
    private String sortRank;
  }

  @Data
  public static class UpdateTask {
    private String listId;
    private String parentId;
    private String title;

    @Size(max = 10000)
    private String notes;

    @Min(0)
    @Max(3)
    private Integer priority;

    private LocalDate dueDate;
    private Instant dueAt;

    @Size(max = 5)
    @Valid
    private List<ReminderSpecDto> reminderSpec;

    @Valid
    private RecurrenceInput recurrence;

    @Size(max = 10)
    private List<String> tagIds;

    @Size(max = 128)
    private String sortRank;

    private Instant completedAt;

    @JsonIgnore private boolean parentIdPresent;
    @JsonIgnore private boolean dueDatePresent;
    @JsonIgnore private boolean dueAtPresent;
    @JsonIgnore private boolean recurrencePresent;
    @JsonIgnore private boolean completedAtPresent;
    @JsonIgnore private boolean reminderSpecPresent;
    @JsonIgnore private boolean tagIdsPresent;

    public void setParentId(String parentId) {
      this.parentId = parentId;
      this.parentIdPresent = true;
    }

    public void setDueDate(LocalDate dueDate) {
      this.dueDate = dueDate;
      this.dueDatePresent = true;
    }

    public void setDueAt(Instant dueAt) {
      this.dueAt = dueAt;
      this.dueAtPresent = true;
    }

    public void setRecurrence(RecurrenceInput recurrence) {
      this.recurrence = recurrence;
      this.recurrencePresent = true;
    }

    public void setCompletedAt(Instant completedAt) {
      this.completedAt = completedAt;
      this.completedAtPresent = true;
    }

    public void setReminderSpec(List<ReminderSpecDto> reminderSpec) {
      this.reminderSpec = reminderSpec;
      this.reminderSpecPresent = true;
    }

    public void setTagIds(List<String> tagIds) {
      this.tagIds = tagIds;
      this.tagIdsPresent = true;
    }
  }

  @Data
  public static class CompleteTask {
    @Size(max = 128)
    private String occurrenceKey;

    @NotBlank
    @Pattern(regexp = "[0-9a-fA-F-]{36}")
    private String completionId;
  }

  @Data
  public static class UncompleteTask {
    @NotBlank
    @Pattern(regexp = "[0-9a-fA-F-]{36}")
    private String completionId;
  }

  @Data
  public static class BatchTask {
    @NotBlank
    @Pattern(regexp = "complete|delete|move")
    private String action;

    @NotNull
    @Size(min = 1, max = 100)
    private List<String> taskIds;

    private String targetListId;
  }

  @Data
  public static class ReorderTasks {
    @NotNull
    @Size(min = 1, max = 200)
    @Valid
    private List<ReorderItem> items;
  }

  @Data
  public static class ReorderItem {
    @NotBlank
    private String taskId;

    @NotBlank
    @Size(max = 128)
    private String sortRank;
  }

  public record ListQuery(
      String view,
      String listId,
      String status,
      String q,
      LocalDate dueFrom,
      LocalDate dueTo,
      String cursor,
      int limit) {}

  public static TaskDto from(
      Task task, List<String> tagIds, List<ReminderSpecDto> specs) {
    RecurrenceDto recurrence =
        task.getRecurrenceRule() == null || task.getRecurrenceDtstart() == null
            ? null
            : new RecurrenceDto(
                task.getRecurrenceRule(),
                task.getRecurrenceTimezone(),
                TimeUtils.iso(task.getRecurrenceDtstart()),
                task.getRecurrenceUntil() == null ? null : task.getRecurrenceUntil().toString(),
                task.getRecurrenceCountRemaining(),
                task.getRecurrenceSeq());
    return new TaskDto(
        task.getId(),
        task.getListId(),
        task.getParentId(),
        task.getTitle(),
        task.getNotes(),
        task.getPriority() == null ? 0 : task.getPriority(),
        task.getDueDate() == null ? null : task.getDueDate().toString(),
        task.getDueAt() == null ? null : TimeUtils.iso(task.getDueAt()),
        task.getCompletedAt() == null ? null : TimeUtils.iso(task.getCompletedAt()),
        task.getLastCompletedAt() == null ? null : TimeUtils.iso(task.getLastCompletedAt()),
        specs,
        recurrence,
        tagIds,
        task.getSortRank(),
        task.getVersion(),
        task.getCreatedAt() == null ? null : TimeUtils.iso(task.getCreatedAt()),
        task.getUpdatedAt() == null ? null : TimeUtils.iso(task.getUpdatedAt()),
        task.getDeletedAt() == null ? null : TimeUtils.iso(task.getDeletedAt()));
  }
}
