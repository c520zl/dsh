package com.todoapp.mapper;

import com.todoapp.export.ExportJob;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface ExportMapper {
  int insertJob(ExportJob job);

  ExportJob selectJob(@Param("userId") String userId, @Param("id") String id);

  ExportJob selectJobById(@Param("id") String id);

  List<ExportJob> selectPending(@Param("limit") int limit);

  int markProcessing(@Param("id") String id);

  int markReady(
      @Param("id") String id,
      @Param("storageKey") String storageKey,
      @Param("expiresAt") LocalDateTime expiresAt);

  int markFailed(@Param("id") String id, @Param("error") String error);

  int markExpired(@Param("id") String id);

  int resetStaleProcessing(@Param("cutoff") LocalDateTime cutoff);

  int deleteOld(@Param("cutoff") LocalDateTime cutoff);

  List<ExportJob> selectExpired(@Param("cutoff") LocalDateTime cutoff);
}
