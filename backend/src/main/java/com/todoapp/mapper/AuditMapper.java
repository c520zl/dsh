package com.todoapp.mapper;

import com.todoapp.auth.AuditLog;
import org.apache.ibatis.annotations.Param;

public interface AuditMapper {
  int insert(AuditLog log);

  int deleteBefore(@Param("before") java.time.LocalDateTime before);
}
