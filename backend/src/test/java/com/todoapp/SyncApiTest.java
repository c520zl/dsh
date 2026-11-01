package com.todoapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.todoapp.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class SyncApiTest extends IntegrationTestBase {
  private JsonNode push(Session user, List<Map<String, Object>> ops) throws Exception {
    return post("/v1/sync/push", Map.of("deviceId", user.deviceId(), "ops", ops), user.accessToken());
  }

  @Test
  void snapshotPushPullAndOpIdempotency() throws Exception {
    Session user = registerUser();
    assertEquals(0, get("/v1/sync/snapshot", user.accessToken()).path("cursor").asLong());
    String taskId = uuid();
    String opId = uuid();
    Map<String, Object> op = map(
        "opId", opId,
        "entity", "task",
        "entityId", taskId,
        "op", "create",
        "patch", map("title", "同步任务", "listId", user.inboxId()));
    JsonNode created = push(user, List.of(op));
    assertEquals("applied", created.path("results").get(0).path("status").asText());
    assertEquals(1, created.path("results").get(0).path("version").asInt());
    JsonNode duplicate = push(user, List.of(op));
    assertEquals(taskId, duplicate.path("results").get(0).path("task").path("id").asText());
    long cursor = get("/v1/sync/snapshot", user.accessToken()).path("cursor").asLong();
    assertTrue(cursor > 0);
    JsonNode pulled = get("/v1/sync/pull?since=0", user.accessToken());
    assertEquals(1, pulled.path("changes").size());
    assertEquals(taskId, pulled.path("changes").get(0).path("entityId").asText());
    JsonNode empty = get("/v1/sync/pull?since=" + pulled.path("nextCursor").asLong(), user.accessToken());
    assertEquals(0, empty.path("changes").size());
  }

  @Test
  void fieldLevelConflictMerge() throws Exception {
    Session user = registerUser();
    JsonNode task = createTask(user, map("title", "服务端标题", "notes", "初始"));
    JsonNode serverUpdate = patch(
        "/v1/tasks/" + task.path("id").asText(), Map.of("title", "服务端新标题"), user.accessToken());
    assertEquals(2, serverUpdate.path("version").asInt());
    JsonNode merged = push(
        user,
        List.of(map(
            "opId", uuid(),
            "entity", "task",
            "entityId", task.path("id").asText(),
            "op", "update",
            "baseVersion", 1,
            "patch", map("title", "客户端标题", "notes", "客户端备注"))));
    JsonNode result = merged.path("results").get(0);
    assertEquals("conflict", result.path("status").asText());
    assertEquals("title", result.path("conflictFields").get(0).asText());
    assertEquals("服务端新标题", result.path("task").path("title").asText());
    assertEquals("客户端备注", result.path("task").path("notes").asText());
    assertEquals(3, result.path("version").asInt());
  }

  @Test
  void recurringCompleteThroughSyncIsIdempotent() throws Exception {
    Session user = registerUser();
    String dueDate = "2026-12-07";
    JsonNode task = createTask(user, map(
        "title", "同步重复",
        "dueDate", dueDate,
        "recurrence", map(
            "rule", "FREQ=WEEKLY;BYDAY=MO",
            "timezone", "Asia/Shanghai",
            "dtstart", dueDate + "T01:00:00Z",
            "countRemaining", 3,
            "seq", 0)));
    String occurrenceKey = "date:" + dueDate;
    JsonNode completed = push(
        user,
        List.of(map(
            "opId", uuid(),
            "entity", "task",
            "entityId", task.path("id").asText(),
            "op", "complete",
            "baseVersion", 1,
            "occurrenceKey", occurrenceKey,
            "completionId", uuid())));
    JsonNode result = completed.path("results").get(0);
    assertEquals("applied", result.path("status").asText());
    assertEquals(1, result.path("task").path("recurrence").path("seq").asInt());
    assertTrue(result.path("task").path("completedAt").isNull());
    JsonNode duplicate = push(
        user,
        List.of(map(
            "opId", uuid(),
            "entity", "task",
            "entityId", task.path("id").asText(),
            "op", "complete",
            "baseVersion", 1,
            "occurrenceKey", occurrenceKey,
            "completionId", uuid())));
    assertEquals("already_completed", duplicate.path("results").get(0).path("status").asText());
  }

  @Test
  void invalidOpDoesNotDiscardOtherOps() throws Exception {
    Session user = registerUser();
    String validId = uuid();
    JsonNode response = push(
        user,
        List.of(
            map(
                "opId", uuid(),
                "entity", "task",
                "entityId", uuid(),
                "op", "create",
                "patch", map("listId", user.inboxId())),
            map(
                "opId", uuid(),
                "entity", "task",
                "entityId", validId,
                "op", "create",
                "patch", map("title", "有效", "listId", user.inboxId()))));
    assertEquals("rejected", response.path("results").get(0).path("status").asText());
    assertEquals("applied", response.path("results").get(1).path("status").asText());
    assertNotNull(get("/v1/tasks/" + validId, user.accessToken()));
  }

  @Test
  void deviceOwnershipIsEnforced() throws Exception {
    Session user = registerUser();
    Session other = registerUser();
    int status = status(
        MockMvcRequestBuilders.post("/v1/sync/push"),
        Map.of(
            "deviceId", other.deviceId(),
            "ops", List.of(map(
                "opId", uuid(), "entity", "task", "entityId", uuid(), "op", "create",
                "patch", map("title", "x", "listId", user.inboxId())))),
        user.accessToken());
    assertEquals(403, status);
  }
}
