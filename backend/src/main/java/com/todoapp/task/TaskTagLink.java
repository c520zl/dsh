package com.todoapp.task;

import lombok.Data;

@Data
public class TaskTagLink {
  private String taskId;
  private String tagId;
}
