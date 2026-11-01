package com.todoapp.reminder;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("notify_reminders")
public class Reminder {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String taskId;
  private String reminderKey;
  private String occurrenceKey;
  private LocalDateTime remindAt;
  private String status;
  private LocalDateTime claimedAt;
  private LocalDateTime sentAt;
  private Integer attemptCount;
  private LocalDateTime createdAt;
}
