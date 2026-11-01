package com.todoapp.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("ops_audit_log")
public class AuditLog {
  @TableId(type = IdType.AUTO)
  private Long id;
  private String userId;
  private String event;
  private String ipHash;
  private String metadata;
  private LocalDateTime createdAt;
}
