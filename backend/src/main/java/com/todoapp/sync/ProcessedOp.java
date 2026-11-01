package com.todoapp.sync;

import java.time.LocalDateTime;
import lombok.Data;

@Data
public class ProcessedOp {
  private String userId;
  private String opId;
  private String result;
  private LocalDateTime createdAt;
}
