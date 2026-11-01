package com.todoapp.task;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("todo_tasks")
public class Task {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String listId;
  private String parentId;
  private String title;
  private String notes;
  private Integer priority;
  private LocalDate dueDate;
  private LocalDateTime dueAt;
  private LocalDateTime completedAt;
  private LocalDateTime lastCompletedAt;
  private String recurrenceRule;
  private LocalDateTime recurrenceDtstart;
  private LocalDate recurrenceUntil;
  private Integer recurrenceCountRemaining;
  private Integer recurrenceSeq;
  private String recurrenceTimezone;
  private String reminderSpec;
  private String sortRank;
  private Long version;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;
  private LocalDateTime deletedAt;
}
