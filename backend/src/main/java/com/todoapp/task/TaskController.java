package com.todoapp.task;

import com.todoapp.common.ApiException;
import com.todoapp.common.AuthPrincipal;
import com.todoapp.common.IdempotencyService;
import com.todoapp.common.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/tasks")
@Validated
public class TaskController {
  private final TaskService taskService;
  private final IdempotencyService idempotencyService;

  public TaskController(TaskService taskService, IdempotencyService idempotencyService) {
    this.taskService = taskService;
    this.idempotencyService = idempotencyService;
  }

  @GetMapping
  public TaskDtos.TaskPage list(
      @AuthenticationPrincipal AuthPrincipal principal,
      @RequestParam(required = false) @Pattern(regexp = "today|upcoming|all|completed|trash") String view,
      @RequestParam(required = false) String listId,
      @RequestParam(required = false) @Pattern(regexp = "open|completed|deleted") String status,
      @RequestParam(required = false) @Size(max = 200) String q,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dueFrom,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dueTo,
      @RequestParam(required = false) @Size(max = 512) String cursor,
      @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
    if (listId != null) {
      Ids.requireUuid(listId, "listId");
    }
    return taskService.list(
        principal.userId(),
        new TaskDtos.ListQuery(view, listId, status, q, dueFrom, dueTo, cursor, limit));
  }

  @PostMapping
  public ResponseEntity<Object> create(
      @AuthenticationPrincipal AuthPrincipal principal,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @Valid @RequestBody TaskDtos.CreateTask body) {
    if (idempotencyKey != null && !Ids.isUuid(idempotencyKey)) {
      throw ApiException.badRequest("Idempotency-Key 必须是 UUID");
    }
    Object result = idempotencyService.run(
        principal.userId(),
        idempotencyKey,
        () -> taskService.create(principal.userId(), principal.deviceId(), body));
    return ResponseEntity.status(201).body(result);
  }

  @GetMapping("/{taskId}")
  public TaskDtos.TaskDto get(
      @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String taskId) {
    return taskService.get(principal.userId(), Ids.requireUuid(taskId, "taskId"));
  }

  @PatchMapping("/{taskId}")
  public TaskDtos.TaskDto update(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String taskId,
      @RequestHeader(value = "If-Match", required = false) String ifMatch,
      @Valid @RequestBody TaskDtos.UpdateTask body) {
    Long version = null;
    if (ifMatch != null && !ifMatch.isBlank()) {
      try {
        version = Long.parseLong(ifMatch.replace("\"", "").trim());
        if (version < 1) {
          throw new NumberFormatException();
        }
      } catch (NumberFormatException error) {
        throw ApiException.badRequest("If-Match 必须是正整数版本号");
      }
    }
    return taskService.update(
        principal.userId(), principal.deviceId(), Ids.requireUuid(taskId, "taskId"), body, version);
  }

  @DeleteMapping("/{taskId}")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String taskId) {
    taskService.remove(principal.userId(), principal.deviceId(), Ids.requireUuid(taskId, "taskId"));
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/{taskId}/restore")
  public TaskDtos.TaskDto restore(
      @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String taskId) {
    return taskService.restore(principal.userId(), principal.deviceId(), Ids.requireUuid(taskId, "taskId"));
  }

  @PostMapping("/{taskId}/complete")
  public TaskDtos.CompleteTaskResponse complete(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String taskId,
      @Valid @RequestBody TaskDtos.CompleteTask body) {
    return taskService.complete(
        principal.userId(), principal.deviceId(), Ids.requireUuid(taskId, "taskId"), body);
  }

  @PostMapping("/{taskId}/uncomplete")
  public TaskDtos.TaskDto uncomplete(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String taskId,
      @Valid @RequestBody TaskDtos.UncompleteTask body) {
    return taskService.uncomplete(
        principal.userId(), principal.deviceId(), Ids.requireUuid(taskId, "taskId"), body);
  }

  @PostMapping("/batch")
  public Object batch(
      @AuthenticationPrincipal AuthPrincipal principal,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @Valid @RequestBody TaskDtos.BatchTask body) {
    if (idempotencyKey != null && !Ids.isUuid(idempotencyKey)) {
      throw ApiException.badRequest("Idempotency-Key 必须是 UUID");
    }
    return idempotencyService.run(
        principal.userId(),
        idempotencyKey,
        () -> taskService.batch(principal.userId(), principal.deviceId(), body));
  }

  @PostMapping("/reorder")
  public ResponseEntity<Void> reorder(
      @AuthenticationPrincipal AuthPrincipal principal,
      @Valid @RequestBody TaskDtos.ReorderTasks body) {
    taskService.reorder(principal.userId(), principal.deviceId(), body);
    return ResponseEntity.noContent().build();
  }
}
