package com.todoapp.worker;

import com.todoapp.common.TimeUtils;
import com.todoapp.config.AppProperties;
import com.todoapp.export.ExportService;
import com.todoapp.mapper.AuditMapper;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.IdempotencyMapper;
import com.todoapp.mapper.SyncMapper;
import com.todoapp.mapper.TaskMapper;
import com.todoapp.reminder.ReminderService;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class CleanupService {
  private static final Logger log = LoggerFactory.getLogger(CleanupService.class);
  private final ReminderService reminderService;
  private final ExportService exportService;
  private final TaskMapper taskMapper;
  private final IdentityMapper identityMapper;
  private final IdempotencyMapper idempotencyMapper;
  private final SyncMapper syncMapper;
  private final AuditMapper auditMapper;
  private final AppProperties properties;

  public CleanupService(
      ReminderService reminderService,
      ExportService exportService,
      TaskMapper taskMapper,
      IdentityMapper identityMapper,
      IdempotencyMapper idempotencyMapper,
      SyncMapper syncMapper,
      AuditMapper auditMapper,
      AppProperties properties) {
    this.reminderService = reminderService;
    this.exportService = exportService;
    this.taskMapper = taskMapper;
    this.identityMapper = identityMapper;
    this.idempotencyMapper = idempotencyMapper;
    this.syncMapper = syncMapper;
    this.auditMapper = auditMapper;
    this.properties = properties;
  }

  public Map<String, Integer> run() {
    LocalDateTime now = TimeUtils.nowUtc();
    Map<String, Integer> stats = new LinkedHashMap<>();
    stats.put("remindersExpired", reminderService.expireStale());
    stats.put("remindersStale", reminderService.resetStaleProcessing());
    stats.put("remindersDeleted", reminderService.purgeOld());
    stats.put("exportsDeleted", exportService.purgeOld());
    stats.put(
        "trashTasks",
        taskMapper.deleteTrashBefore(now.minusDays(properties.getRetention().getTrashDays())));
    stats.put(
        "otps",
        identityMapper.deleteExpiredOtps(now.minusHours(1)));
    stats.put(
        "rateLimits",
        identityMapper.deleteExpiredRateLimits(now.minusDays(1)));
    stats.put(
        "changeLog",
        syncMapper.deleteChangeLogBefore(now.minusDays(properties.getRetention().getChangeLogDays())));
    stats.put(
        "idempotency",
        idempotencyMapper.deleteBefore(now.minusDays(1)));
    stats.put(
        "processedOps",
        syncMapper.deleteProcessedOpsBefore(now.minusDays(properties.getRetention().getProcessedOpsDays())));
    stats.put(
        "auditLog",
        auditMapper.deleteBefore(now.minusDays(properties.getRetention().getAuditDays())));
    stats.put(
        "users",
        identityMapper.deleteDeletedUsersBefore(
            now.minusDays(properties.getRetention().getUserDeletionDays())));
    log.info("Cleanup finished: {}", stats);
    return stats;
  }
}
