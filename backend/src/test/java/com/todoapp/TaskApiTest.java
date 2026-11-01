package com.todoapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.todoapp.support.IntegrationTestBase;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class TaskApiTest extends IntegrationTestBase {
  private JsonNode createList(Session user, String name) throws Exception {
    return request(
        MockMvcRequestBuilders.post("/v1/lists"), Map.of("name", name), user.accessToken(), 201);
  }

  @Test
  void listCrudAndTaskMove() throws Exception {
    Session user = registerUser();
    JsonNode list = createList(user, "工作");
    assertEquals("工作", list.path("name").asText());
    JsonNode task = createTask(user, map("title", "任务", "listId", list.path("id").asText()));
    assertEquals(400, status(
        MockMvcRequestBuilders.post("/v1/lists"), Map.of("name", "工作"), user.accessToken()));
    JsonNode renamed = patch(
        "/v1/lists/" + list.path("id").asText(), Map.of("name", "工作项目", "color", "teal"), user.accessToken());
    assertEquals("工作项目", renamed.path("name").asText());
    assertEquals(204, status(
        MockMvcRequestBuilders.delete("/v1/lists/" + list.path("id").asText()),
        Map.of(), user.accessToken()));
    JsonNode moved = get("/v1/tasks/" + task.path("id").asText(), user.accessToken());
    assertEquals(user.inboxId(), moved.path("listId").asText());
    assertEquals(2, moved.path("version").asInt());
  }

  @Test
  void idempotencyKeyReturnsTheSameCreatedTask() throws Exception {
    Session user = registerUser();
    String key = uuid();
    JsonNode first = request(
        MockMvcRequestBuilders.post("/v1/tasks").header("Idempotency-Key", key),
        Map.of("title", "幂等任务"), user.accessToken(), 201);
    JsonNode second = request(
        MockMvcRequestBuilders.post("/v1/tasks").header("Idempotency-Key", key),
        Map.of("title", "幂等任务"), user.accessToken(), 201);
    assertEquals(first.path("id").asText(), second.path("id").asText());
    JsonNode tasks = get("/v1/tasks?q=幂等任务", user.accessToken());
    assertEquals(1, tasks.path("items").size());
  }

  @Test
  void taskValidationAndIfMatch() throws Exception {
    Session user = registerUser();
    assertEquals(400, status(
        MockMvcRequestBuilders.post("/v1/tasks"), Map.of("title", "   "), user.accessToken()));
    assertEquals(400, status(
        MockMvcRequestBuilders.post("/v1/tasks"),
        Map.of("title", "x", "dueDate", "2026-12-01", "dueAt", "2026-12-01T00:00:00Z"),
        user.accessToken()));
    JsonNode task = createTask(user, map("title", "版本任务"));
    assertEquals(412, status(
        MockMvcRequestBuilders.patch("/v1/tasks/" + task.path("id").asText())
            .header("If-Match", "99"),
        Map.of("title", "新标题"), user.accessToken()));
    JsonNode updated = request(
        MockMvcRequestBuilders.patch("/v1/tasks/" + task.path("id").asText()).header("If-Match", "1"),
        Map.of("title", "新标题"), user.accessToken(), 200);
    assertEquals("新标题", updated.path("title").asText());
    assertEquals(2, updated.path("version").asInt());
  }

  @Test
  void completeUndoDeleteRestore() throws Exception {
    Session user = registerUser();
    JsonNode task = createTask(user, map("title", "一次性任务"));
    String id = task.path("id").asText();
    String completionId = uuid();
    JsonNode completed = post(
        "/v1/tasks/" + id + "/complete", Map.of("completionId", completionId), user.accessToken());
    assertEquals("completed", completed.path("status").asText());
    assertFalse(completed.path("task").path("completedAt").isNull());
    JsonNode again = post(
        "/v1/tasks/" + id + "/complete", Map.of("completionId", uuid()), user.accessToken());
    assertEquals("already_completed", again.path("status").asText());
    JsonNode undone = post(
        "/v1/tasks/" + id + "/uncomplete", Map.of("completionId", completionId), user.accessToken());
    assertTrue(undone.path("completedAt").isNull());

    assertEquals(204, status(
        MockMvcRequestBuilders.delete("/v1/tasks/" + id), null, user.accessToken()));
    assertFalse(get("/v1/tasks/" + id, user.accessToken()).path("deletedAt").isNull());
    JsonNode trash = get("/v1/tasks?view=trash", user.accessToken());
    assertTrue(containsId(trash.path("items"), id));
    JsonNode restored = post("/v1/tasks/" + id + "/restore", Map.of(), user.accessToken());
    assertTrue(restored.path("deletedAt").isNull());
  }

  @Test
  void todayUpcomingAndPagination() throws Exception {
    Session user = registerUser("Asia/Shanghai");
    LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
    String yesterday = today.minusDays(1).toString();
    String inThreeDays = today.plusDays(3).toString();
    JsonNode overdue = createTask(user, map("title", "逾期", "dueDate", yesterday));
    JsonNode dueToday = createTask(user, map("title", "今天", "dueDate", today.toString()));
    JsonNode upcoming = createTask(user, map("title", "未来", "dueDate", inThreeDays));
    JsonNode todayView = get("/v1/tasks?view=today", user.accessToken());
    assertTrue(containsId(todayView.path("items"), overdue.path("id").asText()));
    assertTrue(containsId(todayView.path("items"), dueToday.path("id").asText()));
    assertFalse(containsId(todayView.path("items"), upcoming.path("id").asText()));
    JsonNode upcomingView = get("/v1/tasks?view=upcoming", user.accessToken());
    assertTrue(containsId(upcomingView.path("items"), upcoming.path("id").asText()));

    JsonNode first = get("/v1/tasks?limit=2", user.accessToken());
    assertEquals(2, first.path("items").size());
    assertTrue(first.path("hasMore").asBoolean());
    JsonNode second = get(
        "/v1/tasks?limit=2&cursor=" + java.net.URLEncoder.encode(first.path("nextCursor").asText(), "UTF-8"),
        user.accessToken());
    assertFalse(second.path("hasMore").asBoolean());
  }

  @Test
  void tagsAndBatchOperations() throws Exception {
    Session user = registerUser();
    JsonNode tag = request(
        MockMvcRequestBuilders.post("/v1/tags"), Map.of("name", "重要", "color", "amber"), user.accessToken(), 201);
    JsonNode keep = request(
        MockMvcRequestBuilders.post("/v1/tags"), Map.of("name", "保留", "color", "teal"), user.accessToken(), 201);
    JsonNode task = createTask(user, map(
        "title", "带标签", "tagIds", List.of(tag.path("id").asText(), keep.path("id").asText())));
    assertEquals(2, task.path("tagIds").size());
    assertEquals(204, status(
        MockMvcRequestBuilders.delete("/v1/tags/" + tag.path("id").asText()), null, user.accessToken()));
    JsonNode after = get("/v1/tasks/" + task.path("id").asText(), user.accessToken());
    assertEquals(1, after.path("tagIds").size());
    assertEquals(keep.path("id").asText(), after.path("tagIds").get(0).asText());

    JsonNode a = createTask(user, map("title", "A"));
    JsonNode b = createTask(user, map("title", "B"));
    JsonNode batch = post(
        "/v1/tasks/batch",
        Map.of("action", "complete", "taskIds", List.of(a.path("id").asText(), b.path("id").asText())),
        user.accessToken());
    assertEquals(2, batch.path("results").size());
    assertEquals("applied", batch.path("results").get(0).path("status").asText());
  }

  private static boolean containsId(JsonNode items, String id) {
    for (JsonNode item : items) {
      if (id.equals(item.path("id").asText())) {
        return true;
      }
    }
    return false;
  }
}
