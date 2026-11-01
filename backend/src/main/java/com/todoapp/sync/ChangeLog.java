package com.todoapp.sync;

import java.time.LocalDateTime;
import lombok.Data;

@Data
public class ChangeLog {
  private String userId;
  private Long seq;
  private String entityType;
  private String entityId;
  private Long entityVersion;
  private String op;
  private String changedFields;
  private String deviceId;
  private LocalDateTime createdAt;
}
