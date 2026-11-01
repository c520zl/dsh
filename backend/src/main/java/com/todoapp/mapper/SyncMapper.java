package com.todoapp.mapper;

import com.todoapp.sync.ChangeLog;
import com.todoapp.sync.ProcessedOp;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface SyncMapper {
  int insertSyncStateIfAbsent(@Param("userId") String userId);

  Long selectSeqForUpdate(@Param("userId") String userId);

  Long selectCurrentSeq(@Param("userId") String userId);

  int updateCurrentSeq(@Param("userId") String userId, @Param("seq") long seq);

  int insertChangeLog(ChangeLog changeLog);

  List<ChangeLog> selectChanges(
      @Param("userId") String userId,
      @Param("since") long since,
      @Param("limit") int limit);

  Long selectOldestSeq(@Param("userId") String userId);

  List<ChangeLog> selectEntityChangesSince(
      @Param("userId") String userId,
      @Param("entityType") String entityType,
      @Param("entityId") String entityId,
      @Param("baseVersion") long baseVersion);

  int deleteChangeLogBefore(@Param("before") LocalDateTime before);

  ProcessedOp selectProcessedOp(
      @Param("userId") String userId, @Param("opId") String opId);

  int insertProcessedOp(ProcessedOp processedOp);

  int deleteProcessedOpsBefore(@Param("before") LocalDateTime before);
}
