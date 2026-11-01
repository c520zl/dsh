package com.todoapp.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("identity_refresh_tokens")
public class RefreshToken {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String deviceId;
  private String familyId;
  private String replacedById;
  private String tokenHash;
  private LocalDateTime expiresAt;
  private LocalDateTime rotatedAt;
  private LocalDateTime revokedAt;
  private LocalDateTime createdAt;
}
