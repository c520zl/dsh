package com.todoapp.sync;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.mapper.SyncMapper;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class ChangeLogService {
  private final SyncMapper syncMapper;
  private final ObjectMapper objectMapper;

  public ChangeLogService(SyncMapper syncMapper, ObjectMapper objectMapper) {
    this.syncMapper = syncMapper;
    this.objectMapper = objectMapper;
  }

  /** Must run inside the write transaction so seq order matches commit order. */
  public long append(
      String userId,
      String entityType,
      String entityId,
      long version,
      String op,
      Map<String, Object> changedFields,
      String deviceId) {
    syncMapper.insertSyncStateIfAbsent(userId);
    Long current = syncMapper.selectSeqForUpdate(userId);
    long next = (current == null ? 0 : current) + 1;
    syncMapper.updateCurrentSeq(userId, next);
    ChangeLog log = new ChangeLog();
    log.setUserId(userId);
    log.setSeq(next);
    log.setEntityType(entityType);
    log.setEntityId(entityId);
    log.setEntityVersion(version);
    log.setOp(op);
    log.setChangedFields(writeJson(changedFields));
    log.setDeviceId(deviceId);
    syncMapper.insertChangeLog(log);
    return next;
  }

  private String writeJson(Map<String, Object> value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("Failed to serialize change log", error);
    }
  }
}
