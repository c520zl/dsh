package com.todoapp.me;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import java.time.LocalTime;
import lombok.Data;

@Data
@TableName("identity_user_settings")
public class UserSettings {
  @TableId(type = IdType.INPUT)
  private String userId;
  private String theme;
  private String accent;
  private String weekStart;
  private String defaultListId;
  private LocalTime defaultReminderTime;
  private String timeFormat;
  private LocalTime quietHoursStart;
  private LocalTime quietHoursEnd;
  private String notificationPrefs;
  private Long version;
  private LocalDateTime updatedAt;
}
