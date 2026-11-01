package com.todoapp.task;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("todo_task_completions")
public class TaskCompletion {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String taskId;
  private String occurrenceKey;
  private LocalDateTime occurrenceDueAt;
  private LocalDate occurrenceDueDate;
  private LocalDateTime completedAt;
  private String deviceId;
  private LocalDateTime previousDueAt;
  private LocalDate previousDueDate;
  private Integer previousCountRemaining;
  private Integer previousSeq;
  private LocalDateTime previousLastCompletedAt;
  private LocalDateTime createdAt;
}
