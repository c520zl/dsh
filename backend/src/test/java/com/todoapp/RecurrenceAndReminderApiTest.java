package com.todoapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.todoapp.mapper.ReminderMapper;
import com.todoapp.reminder.Reminder;
import com.todoapp.reminder.ReminderService;
import com.todoapp.support.IntegrationTestBase;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class RecurrenceAndReminderApiTest extends IntegrationTestBase {
  @Autowired ReminderMapper reminderMapper;
  @Autowired ReminderService reminderService;

  @Test
  void weeklyCompletionAdvancesAndUndoRestores() throws Exception {
    Session user = registerUser("Asia/Shanghai");
    String dueDate = "2026-12-07";
    JsonNode task = createTask(user, map(
        "title", "每周站会",
        "dueDate", dueDate,
        "recurrence", map(
            "rule", "FREQ=WEEKLY;BYDAY=MO",
            "timezone", "Asia/Shanghai",
            "dtstart", dueDate + "T01:00:00Z",
            "countRemaining", 3,
            "seq", 0)));
    String completionId = uuid();
    JsonNode completed = post(
        "/v1/tasks/" + task.path("id").asText() + "/complete",
        Map.of("occurrenceKey", "date:" + dueDate, "completionId", completionId),
        user.accessToken());
    assertEquals("completed", completed.path("status").asText());
    assertEquals(1, completed.path("task").path("recurrence").path("seq").asInt());
    assertEquals(2, completed.path("task").path("recurrence").path("countRemaining").asInt());
    assertEquals("2026-12-14", completed.path("task").path("dueDate").asText());
    assertTrue(completed.path("task").path("completedAt").isNull());

    JsonNode duplicate = post(
        "/v1/tasks/" + task.path("id").asText() + "/complete",
        Map.of("occurrenceKey", "date:" + dueDate, "completionId", uuid()),
        user.accessToken());
    assertEquals("already_completed", duplicate.path("status").asText());

    JsonNode undone = post(
        "/v1/tasks/" + task.path("id").asText() + "/uncomplete",
        Map.of("completionId", completionId),
        user.accessToken());
    assertEquals(dueDate, undone.path("dueDate").asText());
    assertEquals(0, undone.path("recurrence").path("seq").asInt());
    assertEquals(3, undone.path("recurrence").path("countRemaining").asInt());
  }

  @Test
  void countExhaustionEndsSeries() throws Exception {
    Session user = registerUser("Asia/Shanghai");
    String dueDate = "2026-12-08";
    JsonNode task = createTask(user, map(
        "title", "最后一次",
        "dueDate", dueDate,
        "recurrence", map(
            "rule", "FREQ=DAILY",
            "timezone", "Asia/Shanghai",
            "dtstart", dueDate + "T01:00:00Z",
            "countRemaining", 1,
            "seq", 0)));
    JsonNode completed = post(
        "/v1/tasks/" + task.path("id").asText() + "/complete",
        Map.of("occurrenceKey", "date:" + dueDate, "completionId", uuid()),
        user.accessToken());
    assertFalse(completed.path("task").path("completedAt").isNull());
    assertEquals(0, completed.path("task").path("recurrence").path("countRemaining").asInt());
  }

  @Test
  void remindersAreMaterializedAndDispatchedOnce() throws Exception {
    Session user = registerUser();
    String reminderId = uuid();
    Instant dueAt = Instant.now().plus(10, ChronoUnit.MINUTES).truncatedTo(ChronoUnit.SECONDS);
    JsonNode task = createTask(user, map(
        "title", "提醒我",
        "dueAt", dueAt.toString(),
        "reminderSpec", List.of(map("id", reminderId, "offsetMinutes", -10))));
    List<Reminder> pending = reminderMapper.selectPendingForTask(user.userId(), task.path("id").asText());
    assertEquals(1, pending.size());
    assertEquals(reminderId, pending.get(0).getReminderKey());
    assertEquals("pending", pending.get(0).getStatus());
    assertTrue(reminderService.dispatchDue(100) >= 1);
    Reminder after = reminderMapper.selectPendingForTask(user.userId(), task.path("id").asText()).stream()
        .findFirst().orElse(null);
    // sent reminders are no longer in the pending/processing query
    assertEquals(null, after);
    assertEquals(
        "sent",
        reminderMapper.selectForUser(user.userId()).stream()
            .filter(item -> reminderId.equals(item.getReminderKey()))
            .findFirst()
            .map(Reminder::getStatus)
            .orElse(null));
  }

  @Test
  void jsonExportProducesDownloadableFile() throws Exception {
    Session user = registerUser();
    createTask(user, map("title", "导出任务", "notes", "备注"));
    JsonNode job = request(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/export"),
        Map.of("format", "json"), user.accessToken(), 202);
    assertNotNull(job.path("id").asText());
    JsonNode ready = pollExport(user, job.path("id").asText());
    assertEquals("ready", ready.path("status").asText());
    assertTrue(ready.path("downloadUrl").asText().contains("/download"));
    JsonNode payload = get("/v1/export/" + job.path("id").asText() + "/download", user.accessToken());
    assertEquals(user.email(), payload.path("user").path("email").asText());
    assertTrue(payload.path("tasks").toString().contains("导出任务"));
  }

  private JsonNode pollExport(Session user, String exportId) throws Exception {
    for (int i = 0; i < 20; i += 1) {
      JsonNode job = get("/v1/export/" + exportId, user.accessToken());
      if (!"pending".equals(job.path("status").asText()) && !"processing".equals(job.path("status").asText())) {
        return job;
      }
      exportService().processPending(10);
      Thread.sleep(50);
    }
    return get("/v1/export/" + exportId, user.accessToken());
  }

  @Autowired com.todoapp.export.ExportService exportService;

  private com.todoapp.export.ExportService exportService() {
    return exportService;
  }
}
