package com.todoapp.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("identity_users")
public class User {
  @TableId(type = IdType.INPUT)
  private String id;
  private String email;
  private String displayName;
  private String avatar;
  private String timezone;
  private String locale;
  private Long authVersion;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;
  private LocalDateTime deletedAt;
}
