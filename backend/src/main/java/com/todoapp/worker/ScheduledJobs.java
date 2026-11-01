package com.todoapp.worker;

import com.todoapp.export.ExportService;
import com.todoapp.reminder.ReminderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "app.worker", name = "enabled", havingValue = "true", matchIfMissing = true)
public class ScheduledJobs {
  private static final Logger log = LoggerFactory.getLogger(ScheduledJobs.class);
  private final ReminderService reminderService;
  private final ExportService exportService;
  private final CleanupService cleanupService;

  public ScheduledJobs(
      ReminderService reminderService, ExportService exportService, CleanupService cleanupService) {
    this.reminderService = reminderService;
    this.exportService = exportService;
    this.cleanupService = cleanupService;
  }

  @Scheduled(fixedDelayString = "${app.worker.reminder-tick-ms:5000}")
  public void reminders() {
    try {
      reminderService.resetStaleProcessing();
      reminderService.expireStale();
      int dispatched = reminderService.dispatchDue(200);
      if (dispatched > 0) {
        log.info("Dispatched {} reminders", dispatched);
      }
    } catch (RuntimeException error) {
      log.error("Reminder tick failed", error);
    }
  }

  @Scheduled(fixedDelayString = "${app.worker.export-tick-ms:5000}")
  public void exports() {
    try {
      exportService.resetStale();
      int processed = exportService.processPending(5);
      if (processed > 0) {
        log.info("Processed {} export jobs", processed);
      }
    } catch (RuntimeException error) {
      log.error("Export tick failed", error);
    }
  }

  @Scheduled(fixedDelayString = "${app.worker.cleanup-tick-ms:3600000}")
  public void cleanup() {
    try {
      cleanupService.run();
    } catch (RuntimeException error) {
      log.error("Cleanup tick failed", error);
    }
  }
}
