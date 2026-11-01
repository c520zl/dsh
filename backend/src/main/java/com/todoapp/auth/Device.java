package com.todoapp.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("identity_devices")
public class Device {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String name;
  private String platform;
  private String appVersion;
  private String osVersion;
  private String pushToken;
  private String pushProvider;
  private Long authVersion;
  private LocalDateTime lastSeenAt;
  private LocalDateTime revokedAt;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;
}
