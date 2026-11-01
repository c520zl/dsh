package com.todoapp.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.todoapp.auth.Device;
import com.todoapp.common.ApiException;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.SyncMapper;
import com.todoapp.reminder.ReminderService;
import com.todoapp.task.Task;
import com.todoapp.task.TaskDtos;
import com.todoapp.task.TaskService;
import jakarta.validation.Validator;
import java.util.LinkedHashMap;
import com.todoapp.list.ListDtos;
import com.todoapp.list.ListService;
import com.todoapp.tag.TagDtos;
import com.todoapp.tag.TagService;
import com.todoapp.mapper.ListMapper;
import com.todoapp.mapper.TagMapper;
import com.todoapp.mapper.TaskMapper;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class SyncService {
  private static final Logger log = LoggerFactory.getLogger(SyncService.class);

  private final SyncMapper syncMapper;
  private final IdentityMapper identityMapper;
  private final TaskMapper taskMapper;
  private final ListMapper listMapper;
  private final TagMapper tagMapper;
  private final TaskService taskService;
  private final ListService listService;
  private final TagService tagService;
  private final ReminderService reminderService;
  private final ObjectMapper objectMapper;
  private final Validator validator;
  private final TransactionTemplate transactionTemplate;
  private final TransactionTemplate nestedTemplate;

  public SyncService(
      SyncMapper syncMapper,
      IdentityMapper identityMapper,
      TaskMapper taskMapper,
      ListMapper listMapper,
      TagMapper tagMapper,
      TaskService taskService,
      ListService listService,
      TagService tagService,
      ReminderService reminderService,
      ObjectMapper objectMapper,
      Validator validator,
      PlatformTransactionManager transactionManager) {
    this.syncMapper = syncMapper;
    this.identityMapper = identityMapper;
    this.taskMapper = taskMapper;
    this.listMapper = listMapper;
    this.tagMapper = tagMapper;
    this.taskService = taskService;
    this.listService = listService;
    this.tagService = tagService;
    this.reminderService = reminderService;
    this.objectMapper = objectMapper;
    this.validator = validator;
    this.transactionTemplate = new TransactionTemplate(transactionManager);
    this.nestedTemplate = new TransactionTemplate(transactionManager);
    this.nestedTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  public SyncDtos.SnapshotResponse snapshot(String userId) {
    Long seq = syncMapper.selectCurrentSeq(userId);
    return new SyncDtos.SnapshotResponse(seq == null ? 0 : seq);
  }

  public SyncDtos.PullResponse pull(String userId, long since, int limit) {
    SyncDtos.SnapshotResponse snapshot = snapshot(userId);
    if (since > snapshot.cursor()) {
      return new SyncDtos.PullResponse(List.of(), snapshot.cursor(), false);
    }
    Long oldest = syncMapper.selectOldestSeq(userId);
    List<ChangeLog> rows = syncMapper.selectChanges(userId, since, limit + 1);
    if (rows.isEmpty()) {
      if (since < snapshot.cursor()) {
        throw ApiException.cursorExpired(
            Map.of("since", since, "oldestSeq", oldest == null ? 0 : oldest, "currentSeq", snapshot.cursor()));
      }
      return new SyncDtos.PullResponse(List.of(), since, false);
    }
    if (oldest != null && since + 1 < oldest) {
      throw ApiException.cursorExpired(
          Map.of("since", since, "oldestSeq", oldest, "currentSeq", snapshot.cursor()));
    }
    boolean hasMore = rows.size() > limit;
    List<ChangeLog> page = hasMore ? rows.subList(0, limit) : rows;
    List<SyncDtos.Change> changes = page.stream().map(this::toChange).toList();
    long nextCursor = page.isEmpty() ? since : page.get(page.size() - 1).getSeq();
    return new SyncDtos.PullResponse(changes, nextCursor, hasMore);
  }

  public SyncDtos.PushResponse push(String userId, String authenticatedDeviceId, SyncDtos.PushRequest input) {
    Device device = identityMapper.selectDeviceForUser(input.deviceId(), userId);
    if (device == null || device.getRevokedAt() != null) {
      throw ApiException.forbidden("设备不存在或已被移除");
    }
    List<SyncDtos.OpResult> results =
        transactionTemplate.execute(
            status -> {
              syncMapper.insertSyncStateIfAbsent(userId);
              syncMapper.selectSeqForUpdate(userId);
              List<SyncDtos.OpResult> output = new ArrayList<>();
              for (SyncDtos.SyncOp op : input.ops()) {
                ProcessedOp cached = syncMapper.selectProcessedOp(userId, op.opId());
                if (cached != null) {
                  output.add(readResult(cached.getResult()));
                  continue;
                }
                SyncDtos.OpResult result;
                try {
                  result =
                      nestedTemplate.execute(
                          nested -> applyOp(userId, input.deviceId(), op));
                } catch (ApiException error) {
                  result = errorResult(op.opId(), error);
                } catch (RuntimeException error) {
                  log.error("Sync op failed unexpectedly: {}", op.opId(), error);
                  result = rejected(op.opId(), "INTERNAL", "处理失败", null);
                }
                ProcessedOp processed = new ProcessedOp();
                processed.setUserId(userId);
                processed.setOpId(op.opId());
                processed.setResult(writeJson(result));
                syncMapper.insertProcessedOp(processed);
                output.add(result);
              }
              if (input.localDeliveries() != null && !input.localDeliveries().isEmpty()) {
                List<ReminderService.LocalDelivery> deliveries =
                    input.localDeliveries().stream()
                        .map(item -> new ReminderService.LocalDelivery(
                            item.reminderId(), item.occurrenceKey(), item.deliveredAt()))
                        .toList();
                reminderService.processLocalDeliveries(userId, deliveries);
              }
              return output;
            });
    return new SyncDtos.PushResponse(results == null ? List.of() : results);
  }

  private SyncDtos.OpResult applyOp(String userId, String deviceId, SyncDtos.SyncOp op) {
    return switch (op.entity()) {
      case "task" -> applyTask(userId, deviceId, op);
      case "list" -> applyList(userId, deviceId, op);
      case "tag" -> applyTag(userId, deviceId, op);
      default -> throw ApiException.badRequest("未知的实体类型");
    };
  }

  private SyncDtos.OpResult applyTask(String userId, String deviceId, SyncDtos.SyncOp op) {
    if ("create".equals(op.op())) {
      TaskDtos.CreateTask input = convert(op.patch(), TaskDtos.CreateTask.class);
      input.setId(op.entityId());
      TaskDtos.TaskDto task = taskService.create(userId, deviceId, input);
      return applied(op.opId(), task.version(), task);
    }
    Task current = taskMapper.selectTask(userId, op.entityId());
    if (current == null) {
      return rejected(op.opId(), "NOT_FOUND", "任务不存在", null);
    }
    if (!"delete".equals(op.op()) && current.getDeletedAt() != null) {
      return rejected(op.opId(), "DELETED", "任务已删除", null);
    }
    long baseVersion = requireBaseVersion(op);
    if (baseVersion > current.getVersion()) {
      return rejected(op.opId(), "REBUILD_REQUIRED", "本地版本高于服务端，请全量重建", null);
    }

    if ("update".equals(op.op())) {
      TaskDtos.UpdateTask patch = convert(op.patch(), TaskDtos.UpdateTask.class);
      Set<String> conflicts =
          baseVersion < current.getVersion()
              ? conflictFields(userId, "task", op.entityId(), baseVersion, op.patch())
              : Set.of();
      if (!conflicts.isEmpty()) {
        JsonNode filtered = removeFields(op.patch(), conflicts);
        if (filtered.isEmpty()) {
          return conflict(op.opId(), taskService.get(userId, op.entityId()), conflicts, current.getVersion());
        }
        patch = convert(filtered, TaskDtos.UpdateTask.class);
      }
      TaskDtos.TaskDto updated = taskService.update(userId, deviceId, op.entityId(), patch, null);
      String status = !conflicts.isEmpty() ? "conflict" : (baseVersion < current.getVersion() ? "merged" : "applied");
      return new SyncDtos.OpResult(
          op.opId(), status, updated.version(), new ArrayList<>(conflicts), updated, null);
    }
    if ("delete".equals(op.op())) {
      if (current.getDeletedAt() != null) {
        return new SyncDtos.OpResult(op.opId(), "applied", current.getVersion(), List.of(), null, null);
      }
      taskService.remove(userId, deviceId, op.entityId());
      return new SyncDtos.OpResult(op.opId(), "applied", current.getVersion() + 1, List.of(), null, null);
    }
    if ("complete".equals(op.op())) {
      if (op.completionId() == null) {
        throw ApiException.badRequest("complete 需要 completionId");
      }
      TaskDtos.CompleteTask complete = new TaskDtos.CompleteTask();
      complete.setCompletionId(op.completionId());
      complete.setOccurrenceKey(op.occurrenceKey());
      TaskDtos.CompleteTaskResponse response =
          taskService.complete(userId, deviceId, op.entityId(), complete);
      return new SyncDtos.OpResult(
          op.opId(),
          "already_completed".equals(response.status()) ? "already_completed" : "applied",
          response.task().version(),
          List.of(),
          response.task(),
          null);
    }
    if ("uncomplete".equals(op.op())) {
      if (op.completionId() == null) {
        throw ApiException.badRequest("uncomplete 需要 completionId");
      }
      TaskDtos.UncompleteTask uncomplete = new TaskDtos.UncompleteTask();
      uncomplete.setCompletionId(op.completionId());
      TaskDtos.TaskDto task = taskService.uncomplete(userId, deviceId, op.entityId(), uncomplete);
      return applied(op.opId(), task.version(), task);
    }
    throw ApiException.badRequest("不支持的任务操作");
  }

  private SyncDtos.OpResult applyList(String userId, String deviceId, SyncDtos.SyncOp op) {
    if ("create".equals(op.op())) {
      ListDtos.CreateList input = convert(op.patch(), ListDtos.CreateList.class);
      input.setId(op.entityId());
      ListDtos.ListDto list = listService.create(userId, deviceId, input);
      return applied(op.opId(), list.version(), null);
    }
    var current = listMapper.selectListIncludingDeleted(userId, op.entityId());
    if (current == null) {
      return rejected(op.opId(), "NOT_FOUND", "清单不存在", null);
    }
    if (!"delete".equals(op.op()) && current.getDeletedAt() != null) {
      return rejected(op.opId(), "DELETED", "清单已删除", null);
    }
    long baseVersion = requireBaseVersion(op);
    if (baseVersion > current.getVersion()) {
      return rejected(op.opId(), "REBUILD_REQUIRED", "本地版本高于服务端，请全量重建", null);
    }
    if ("update".equals(op.op())) {
      ListDtos.UpdateList patch = convert(op.patch(), ListDtos.UpdateList.class);
      Set<String> conflicts =
          baseVersion < current.getVersion()
              ? conflictFields(userId, "list", op.entityId(), baseVersion, op.patch())
              : Set.of();
      if (!conflicts.isEmpty()) {
        JsonNode filtered = removeFields(op.patch(), conflicts);
        if (filtered.isEmpty()) {
          return new SyncDtos.OpResult(
              op.opId(), "conflict", current.getVersion(), new ArrayList<>(conflicts), null, null);
        }
        patch = convert(filtered, ListDtos.UpdateList.class);
      }
      ListDtos.ListDto updated = listService.update(userId, deviceId, op.entityId(), patch);
      String status = !conflicts.isEmpty() ? "conflict" : (baseVersion < current.getVersion() ? "merged" : "applied");
      return new SyncDtos.OpResult(
          op.opId(), status, updated.version(), new ArrayList<>(conflicts), null, null);
    }
    if ("delete".equals(op.op())) {
      if (current.getDeletedAt() != null) {
        return new SyncDtos.OpResult(op.opId(), "applied", current.getVersion(), List.of(), null, null);
      }
      ListDtos.DeleteList delete = new ListDtos.DeleteList();
      delete.setTaskAction("move_to_inbox");
      listService.delete(userId, deviceId, op.entityId(), delete);
      return new SyncDtos.OpResult(
          op.opId(), "applied", current.getVersion() + 1, List.of(), null, null);
    }
    return rejected(op.opId(), "VALIDATION_ERROR", "清单不支持该同步操作", null);
  }

  private SyncDtos.OpResult applyTag(String userId, String deviceId, SyncDtos.SyncOp op) {
    if ("create".equals(op.op())) {
      TagDtos.CreateTag input = convert(op.patch(), TagDtos.CreateTag.class);
      input.setId(op.entityId());
      TagDtos.TagDto tag = tagService.create(userId, deviceId, input);
      return applied(op.opId(), tag.version(), null);
    }
    var current = tagMapper.selectTag(userId, op.entityId());
    if (current == null) {
      return rejected(op.opId(), "NOT_FOUND", "标签不存在", null);
    }
    long baseVersion = requireBaseVersion(op);
    if (baseVersion > current.getVersion()) {
      return rejected(op.opId(), "REBUILD_REQUIRED", "本地版本高于服务端，请全量重建", null);
    }
    if ("update".equals(op.op())) {
      TagDtos.UpdateTag patch = convert(op.patch(), TagDtos.UpdateTag.class);
      Set<String> conflicts =
          baseVersion < current.getVersion()
              ? conflictFields(userId, "tag", op.entityId(), baseVersion, op.patch())
              : Set.of();
      if (!conflicts.isEmpty()) {
        JsonNode filtered = removeFields(op.patch(), conflicts);
        if (filtered.isEmpty()) {
          return new SyncDtos.OpResult(
              op.opId(), "conflict", current.getVersion(), new ArrayList<>(conflicts), null, null);
        }
        patch = convert(filtered, TagDtos.UpdateTag.class);
      }
      TagDtos.TagDto updated = tagService.update(userId, deviceId, op.entityId(), patch);
      String status = !conflicts.isEmpty() ? "conflict" : (baseVersion < current.getVersion() ? "merged" : "applied");
      return new SyncDtos.OpResult(
          op.opId(), status, updated.version(), new ArrayList<>(conflicts), null, null);
    }
    if ("delete".equals(op.op())) {
      tagService.delete(userId, deviceId, op.entityId());
      return new SyncDtos.OpResult(
          op.opId(), "applied", current.getVersion() + 1, List.of(), null, null);
    }
    return rejected(op.opId(), "VALIDATION_ERROR", "标签不支持该同步操作", null);
  }

  private Set<String> conflictFields(
      String userId, String entityType, String entityId, long baseVersion, JsonNode patch) {
    if (patch == null || !patch.isObject()) {
      throw ApiException.badRequest("update 需要 patch");
    }
    List<ChangeLog> changes = syncMapper.selectEntityChangesSince(userId, entityType, entityId, baseVersion);
    Set<String> serverChanged = new HashSet<>();
    for (ChangeLog change : changes) {
      serverChanged.addAll(parseChangedFields(change.getChangedFields()).keySet());
    }
    Set<String> patchFields = new HashSet<>();
    patch.fieldNames().forEachRemaining(patchFields::add);
    patchFields.retainAll(serverChanged);
    return patchFields;
  }

  private JsonNode removeFields(JsonNode patch, Set<String> fields) {
    if (patch == null || !patch.isObject()) {
      return objectMapper.createObjectNode();
    }
    ObjectNode copy = patch.deepCopy();
    fields.forEach(copy::remove);
    return copy;
  }

  private long requireBaseVersion(SyncDtos.SyncOp op) {
    if (op.baseVersion() == null) {
      throw ApiException.badRequest(op.op() + " 需要 baseVersion");
    }
    return op.baseVersion();
  }

  private <T> T convert(JsonNode node, Class<T> type) {
    if (node == null || node.isNull()) {
      throw ApiException.badRequest("create/update 需要 patch");
    }
    try {
      T value = objectMapper.treeToValue(node, type);
      var violations = validator.validate(value);
      if (!violations.isEmpty()) {
        List<Map<String, Object>> issues =
            violations.stream()
                .map(violation -> Map.<String, Object>of(
                    "path", violation.getPropertyPath().toString(),
                    "message", String.valueOf(violation.getMessage())))
                .toList();
        throw ApiException.badRequest("参数校验失败", Map.of("issues", issues));
      }
      return value;
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw ApiException.badRequest("参数校验失败", Map.of("reason", String.valueOf(error.getMessage())));
    }
  }

  private SyncDtos.OpResult applied(String opId, long version, Object task) {
    return new SyncDtos.OpResult(opId, "applied", version, List.of(), task, null);
  }

  private SyncDtos.OpResult conflict(String opId, Object task, Set<String> fields, long version) {
    return new SyncDtos.OpResult(opId, "conflict", version, new ArrayList<>(fields), task, null);
  }

  private SyncDtos.OpResult rejected(String opId, String code, String message, Map<String, Object> details) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("code", code);
    body.put("message", message);
    if (details != null) {
      body.put("details", details);
    }
    body.put("requestId", "sync");
    return new SyncDtos.OpResult(opId, "rejected", null, List.of(), null, Map.of("error", body));
  }

  private SyncDtos.OpResult errorResult(String opId, ApiException error) {
    return rejected(
        opId,
        error.getCode().name(),
        error.getMessage(),
        error.getDetails().isEmpty() ? null : error.getDetails());
  }

  private SyncDtos.Change toChange(ChangeLog row) {
    return new SyncDtos.Change(
        row.getSeq(),
        row.getEntityType(),
        row.getEntityId(),
        row.getOp(),
        row.getEntityVersion(),
        parseChangedFields(row.getChangedFields()));
  }

  private Map<String, Object> parseChangedFields(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    try {
      return objectMapper.readValue(
          json, new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() {});
    } catch (Exception error) {
      return Map.of();
    }
  }

  private String writeJson(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  private SyncDtos.OpResult readResult(String json) {
    try {
      return objectMapper.readValue(json, SyncDtos.OpResult.class);
    } catch (Exception error) {
      throw new IllegalStateException("Failed to read processed op result", error);
    }
  }
}
