package com.todoapp.mapper;

import com.todoapp.reminder.Reminder;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface ReminderMapper {
  int cancelForTask(@Param("userId") String userId, @Param("taskId") String taskId);

  int upsertReminder(Reminder reminder);

  List<Reminder> selectPendingForTask(
      @Param("userId") String userId, @Param("taskId") String taskId);

  List<Reminder> selectDueForUpdate(
      @Param("now") LocalDateTime now, @Param("limit") int limit);

  int markProcessing(
      @Param("id") String id,
      @Param("claimedAt") LocalDateTime claimedAt,
      @Param("attemptCount") int attemptCount);

  int markStatus(
      @Param("id") String id,
      @Param("status") String status,
      @Param("sentAt") LocalDateTime sentAt);

  int reschedule(
      @Param("id") String id,
      @Param("status") String status,
      @Param("remindAt") LocalDateTime remindAt,
      @Param("claimedAt") LocalDateTime claimedAt);

  int markLocalDelivered(
      @Param("userId") String userId,
      @Param("reminderKey") String reminderKey,
      @Param("occurrenceKey") String occurrenceKey,
      @Param("deliveredAt") LocalDateTime deliveredAt);

  int expireBefore(@Param("cutoff") LocalDateTime cutoff);

  int resetStaleProcessing(@Param("cutoff") LocalDateTime cutoff);

  int deleteOld(@Param("cutoff") LocalDateTime cutoff);

  List<Reminder> selectForUser(@Param("userId") String userId);
}
