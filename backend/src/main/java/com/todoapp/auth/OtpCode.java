package com.todoapp.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("identity_otp_codes")
public class OtpCode {
  @TableId(type = IdType.INPUT)
  private String email;
  private String codeHash;
  private Integer attempts;
  private LocalDateTime expiresAt;
  private LocalDateTime lastSentAt;
  private LocalDateTime createdAt;
}
