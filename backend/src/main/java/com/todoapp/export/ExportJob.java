package com.todoapp.export;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("ops_export_jobs")
public class ExportJob {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String status;
  private String fileFormat;
  private String storageKey;
  private String error;
  private LocalDateTime expiresAt;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;
}
