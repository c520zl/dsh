package com.todoapp.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("identity_auth_identities")
public class AuthIdentity {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String provider;
  private String providerUserId;
  private LocalDateTime createdAt;
}
