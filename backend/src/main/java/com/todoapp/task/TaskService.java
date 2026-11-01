package com.todoapp.task;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.common.ApiException;
import com.todoapp.common.Ids;
import com.todoapp.common.Recurrence;
import com.todoapp.common.SortRanks;
import com.todoapp.auth.User;
import com.todoapp.common.TimeUtils;
import com.todoapp.list.TodoList;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.ListMapper;
import com.todoapp.mapper.TagMapper;
import com.todoapp.mapper.TaskMapper;
import com.todoapp.me.UserSettings;
import com.todoapp.reminder.ReminderService;
import com.todoapp.sync.ChangeLogService;
import com.todoapp.tag.Tag;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TaskService {
  private static final Logger log = LoggerFactory.getLogger(TaskService.class);
  private static final int DEFAULT_LIMIT = 50;

  private final TaskMapper taskMapper;
  private final ListMapper listMapper;
  private final TagMapper tagMapper;
  private final IdentityMapper identityMapper;
  private final ReminderService reminderService;
  private final ChangeLogService changeLogService;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate nestedTransactionTemplate;

  private record CursorValue(String k, String id) {}

  private record NextOccurrence(
      String dueDate, LocalDateTime dueAt, LocalDateTime completedAt, int seq, Integer countRemaining) {}

  public TaskService(
      TaskMapper taskMapper,
      ListMapper listMapper,
      TagMapper tagMapper,
      IdentityMapper identityMapper,
      ReminderService reminderService,
      ChangeLogService changeLogService,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager) {
    this.taskMapper = taskMapper;
    this.listMapper = listMapper;
    this.tagMapper = tagMapper;
    this.identityMapper = identityMapper;
    this.reminderService = reminderService;
    this.changeLogService = changeLogService;
    this.objectMapper = objectMapper;
    this.nestedTransactionTemplate = new TransactionTemplate(transactionManager);
    this.nestedTransactionTemplate.setPropagationBehavior(
        org.springframework.transaction.TransactionDefinition.PROPAGATION_NESTED);
  }

  public TaskDtos.TaskPage list(String userId, TaskDtos.ListQuery query) {
    User user = identityMapper.selectUserById(userId);
    if (user == null) {
      throw ApiException.notFound("用户不存在");
    }
    ZoneId zone = TimeUtils.zone(user.getTimezone());
    LocalDate today = LocalDate.now(zone);
    LocalDate windowEndDate = today.plusDays(7);
    LocalDateDayBounds todayBounds = bounds(zone, today);
    LocalDateDayBounds nextDayBounds = bounds(zone, today.plusDays(1));
    LocalDateDayBounds windowEndBounds = bounds(zone, today.plusDays(8));
    LocalDateTime completedCutoff = TimeUtils.nowUtc().minusDays(90);
    LocalDateTime trashCutoff = TimeUtils.nowUtc().minusDays(30);
    String orderKind = orderKind(query);
    CursorValue cursor = query.cursor() == null ? null : decodeCursor(query.cursor());
    List<Task> rows =
        taskMapper.listTasks(
            userId,
            query.view(),
            query.listId(),
            query.status(),
            query.q(),
            query.dueFrom(),
            query.dueTo(),
            today,
            todayBounds.start(),
            todayBounds.end(),
            nextDayBounds.start(),
            windowEndDate,
            windowEndBounds.start(),
            completedCutoff,
            trashCutoff,
            cursor == null ? null : cursorKeyValue(orderKind, cursor, zone),
            cursor == null ? null : cursor.id(),
            orderKind,
            query.limit() + 1);
    boolean hasMore = rows.size() > query.limit();
    List<Task> page = hasMore ? rows.subList(0, query.limit()) : rows;
    Map<String, List<String>> tagMap = tagsFor(userId, page);
    List<TaskDtos.TaskDto> items =
        page.stream().map(task -> toDto(task, tagMap.getOrDefault(task.getId(), List.of()))).toList();
    String nextCursor = null;
    if (hasMore && !page.isEmpty()) {
      Task last = page.get(page.size() - 1);
      nextCursor = encodeCursor(new CursorValue(cursorKeyValue(orderKind, last, zone), last.getId()));
    }
    return new TaskDtos.TaskPage(items, nextCursor, hasMore);
  }

  public TaskDtos.TaskDto get(String userId, String taskId) {
    Task task = taskMapper.selectTask(userId, Ids.requireUuid(taskId, "taskId"));
    if (task == null) {
      throw ApiException.notFound("任务不存在");
    }
    return toDto(task, tagIdsForTask(userId, task.getId()));
  }

  @Transactional
  public TaskDtos.TaskDto create(String userId, String deviceId, TaskDtos.CreateTask input) {
    String id = input.getId() == null ? Ids.uuidv7() : Ids.requireUuid(input.getId(), "id");
    Task existing = taskMapper.selectTask(userId, id);
    if (existing != null) {
      if (existing.getDeletedAt() != null) {
        throw ApiException.badRequest("任务 ID 已被使用");
      }
      return toDto(existing, tagIdsForTask(userId, existing.getId()));
    }
    UserSettings settings = identityMapper.selectSettings(userId);
    Task parent = input.getParentId() == null ? null : requireTask(userId, input.getParentId(), true);
    if (parent != null) {
      if (parent.getDeletedAt() != null) {
        throw ApiException.badRequest("父任务已删除");
      }
      if (parent.getParentId() != null) {
        throw ApiException.badRequest("子任务不能作为父任务");
      }
    }
    String listId = input.getListId();
    if (listId == null && parent != null) {
      listId = parent.getListId();
    }
    if (listId == null) {
      listId = settings == null ? null : settings.getDefaultListId();
    }
    if (listId == null) {
      listId = inbox(userId).getId();
    }
    requireActiveList(userId, listId);
    if (parent != null && !parent.getListId().equals(listId)) {
      throw ApiException.badRequest("父任务与子任务必须在同一清单");
    }
    Due due = normalizeDue(input.getDueDate(), input.getDueAt());
    List<TaskDtos.ReminderSpecDto> reminderSpecs =
        input.getReminderSpec() == null ? List.of() : input.getReminderSpec();
    if (!reminderSpecs.isEmpty() && due.dueDate() == null && due.dueAt() == null) {
      throw ApiException.badRequest("提醒需要到期日期或时间");
    }
    ParsedRecurrence recurrence = input.getRecurrence() == null ? null : parseRecurrence(input.getRecurrence());
    if (recurrence != null && due.dueDate() == null && due.dueAt() == null) {
      throw ApiException.badRequest("重复任务需要到期日期或时间");
    }
    List<String> tagIds = input.getTagIds() == null ? List.of() : input.getTagIds();
    validateTags(userId, tagIds);

    Task task = new Task();
    task.setId(id);
    task.setUserId(userId);
    task.setListId(listId);
    task.setParentId(input.getParentId());
    task.setTitle(input.getTitle().trim());
    task.setNotes(input.getNotes() == null ? "" : input.getNotes());
    task.setPriority(input.getPriority() == null ? 0 : input.getPriority());
    task.setDueDate(due.dueDate());
    task.setDueAt(due.dueAt());
    task.setReminderSpec(writeReminderSpecs(reminderSpecs));
    applyRecurrence(task, recurrence);
    task.setSortRank(input.getSortRank() == null ? SortRanks.newTaskSortRank() : input.getSortRank());
    task.setVersion(1L);
    taskMapper.insertTask(task);
    for (String tagId : new LinkedHashSet<>(tagIds)) {
      taskMapper.insertTaskTag(userId, id, tagId);
    }
    Task created = taskMapper.selectTask(userId, id);
    reminderService.rebuildForTask(created);
    appendTaskChange(userId, deviceId, created, tagIds, "upsert", toDtoMap(created, tagIds));
    return toDto(created, tagIds);
  }

  @Transactional
  public TaskDtos.TaskDto update(
      String userId,
      String deviceId,
      String taskId,
      TaskDtos.UpdateTask input,
      Long ifMatch) {
    Task task = requireTaskForUpdate(userId, Ids.requireUuid(taskId, "taskId"));
    String originalListId = task.getListId();
    if (task.getDeletedAt() != null) {
      throw ApiException.deleted("任务已删除");
    }
    if (ifMatch != null && ifMatch != task.getVersion()) {
      throw ApiException.preconditionFailed("任务版本已变化", Map.of("currentVersion", task.getVersion()));
    }
    boolean changed = false;
    Map<String, Object> fields = new LinkedHashMap<>();

    if (input.getListId() != null && !input.getListId().equals(task.getListId())) {
      if (task.getParentId() != null) {
        throw ApiException.badRequest("子任务不能单独移动，请移动父任务");
      }
      requireActiveList(userId, input.getListId());
      task.setListId(input.getListId());
      fields.put("listId", input.getListId());
      changed = true;
    }
    String nextListId = task.getListId();

    Due due = mergeDue(task, input);
    boolean dueChanged = !Objects.equals(task.getDueDate(), due.dueDate())
        || !Objects.equals(task.getDueAt(), due.dueAt());
    if (dueChanged) {
      task.setDueDate(due.dueDate());
      task.setDueAt(due.dueAt());
      fields.put("dueDate", due.dueDate() == null ? null : due.dueDate().toString());
      fields.put("dueAt", due.dueAt() == null ? null : TimeUtils.iso(due.dueAt()));
      changed = true;
    }
    if (input.isReminderSpecPresent()) {
      List<TaskDtos.ReminderSpecDto> specs =
          input.getReminderSpec() == null ? List.of() : input.getReminderSpec();
      if (!specs.isEmpty() && task.getDueDate() == null && task.getDueAt() == null) {
        throw ApiException.badRequest("提醒需要到期日期或时间");
      }
      String json = writeReminderSpecs(specs);
      if (!json.equals(task.getReminderSpec())) {
        task.setReminderSpec(json);
        fields.put("reminderSpec", specs);
        changed = true;
      }
    }
    if (input.isRecurrencePresent()) {
      ParsedRecurrence recurrence = input.getRecurrence() == null ? null : parseRecurrence(input.getRecurrence());
      if (recurrence != null && task.getDueDate() == null && task.getDueAt() == null) {
        throw ApiException.badRequest("重复任务需要到期日期或时间");
      }
      applyRecurrence(task, recurrence);
      fields.put("recurrence", recurrence == null ? null : toMap(recurrence));
      changed = true;
    }
    if (task.getRecurrenceRule() != null && task.getDueDate() == null && task.getDueAt() == null) {
      throw ApiException.badRequest("重复任务需要到期日期或时间");
    }
    if (!parseReminderSpecs(task.getReminderSpec()).isEmpty()
        && task.getDueDate() == null
        && task.getDueAt() == null) {
      throw ApiException.badRequest("提醒需要到期日期或时间");
    }

    if (input.isCompletedAtPresent()) {
      if (input.getCompletedAt() != null && task.getRecurrenceRule() != null) {
        throw ApiException.badRequest("重复任务请使用 complete 接口");
      }
      task.setCompletedAt(input.getCompletedAt() == null ? null : TimeUtils.fromInstant(input.getCompletedAt()));
      fields.put("completedAt", input.getCompletedAt() == null ? null : TimeUtils.iso(input.getCompletedAt()));
      changed = true;
    }

    String nextParentId = task.getParentId();
    if (input.isParentIdPresent()) {
      nextParentId = input.getParentId();
      if (nextParentId != null) {
        if (nextParentId.equals(taskId)) {
          throw ApiException.badRequest("任务不能作为自己的父任务");
        }
        Task parent = requireTask(userId, nextParentId, true);
        if (parent.getDeletedAt() != null) {
          throw ApiException.badRequest("父任务已删除");
        }
        if (parent.getParentId() != null) {
          throw ApiException.badRequest("子任务不能作为父任务");
        }
        if (!parent.getListId().equals(nextListId)) {
          throw ApiException.badRequest("父任务与子任务必须在同一清单");
        }
        if (task.getParentId() == null && !taskMapper.selectChildIds(userId, taskId, true).isEmpty()) {
          throw ApiException.badRequest("有子任务的任务不能成为子任务");
        }
      }
      if (!Objects.equals(nextParentId, task.getParentId())) {
        task.setParentId(nextParentId);
        fields.put("parentId", nextParentId);
        changed = true;
      }
    }

    if (input.getTitle() != null) {
      String title = input.getTitle().trim();
      if (title.isEmpty()) {
        throw ApiException.badRequest("任务标题不能为空");
      }
      if (!title.equals(task.getTitle())) {
        task.setTitle(title);
        fields.put("title", task.getTitle());
        changed = true;
      }
    }
    if (input.getNotes() != null && !input.getNotes().equals(task.getNotes())) {
      task.setNotes(input.getNotes());
      fields.put("notes", task.getNotes());
      changed = true;
    }
    if (input.getPriority() != null && !input.getPriority().equals(task.getPriority())) {
      task.setPriority(input.getPriority());
      fields.put("priority", input.getPriority());
      changed = true;
    }
    if (input.getSortRank() != null && !input.getSortRank().equals(task.getSortRank())) {
      task.setSortRank(input.getSortRank());
      fields.put("sortRank", input.getSortRank());
      changed = true;
    }
    if (input.isTagIdsPresent()) {
      List<String> tagIds = input.getTagIds() == null ? List.of() : input.getTagIds();
      validateTags(userId, tagIds);
      List<String> current = tagIdsForTask(userId, taskId);
      if (!new LinkedHashSet<>(tagIds).equals(new LinkedHashSet<>(current))) {
        taskMapper.deleteTaskTags(userId, taskId);
        for (String tagId : new LinkedHashSet<>(tagIds)) {
          taskMapper.insertTaskTag(userId, taskId, tagId);
        }
        fields.put("tagIds", tagIds);
        changed = true;
      }
    }

    if (!changed) {
      return toDto(task, tagIdsForTask(userId, taskId));
    }
    task.setVersion(task.getVersion() + 1);
    taskMapper.updateTask(task);
    if (!task.getListId().equals(originalListId)) {
      moveChildren(userId, deviceId, taskId, task.getListId());
    }
    reminderService.rebuildForTask(task);
    appendTaskChange(userId, deviceId, task, tagIdsForTask(userId, taskId), "upsert", fields);
    return toDto(taskMapper.selectTask(userId, taskId), tagIdsForTask(userId, taskId));
  }

  private void moveChildren(String userId, String deviceId, String taskId, String listId) {
    for (String childId : taskMapper.selectChildIds(userId, taskId, true)) {
      Task child = taskMapper.selectTask(userId, childId);
      if (child != null && !listId.equals(child.getListId())) {
        child.setListId(listId);
        child.setVersion(child.getVersion() + 1);
        taskMapper.updateTask(child);
        changeLogService.append(
            userId, "task", childId, child.getVersion(), "upsert", Map.of("listId", listId), deviceId);
      }
    }
  }

  // Methods below are filled in by subsequent sections of this class.

  @Transactional
  public void remove(String userId, String deviceId, String taskId) {
    Task task = requireTaskForUpdate(userId, Ids.requireUuid(taskId, "taskId"));
    if (task.getDeletedAt() != null) {
      return;
    }
    LocalDateTime now = TimeUtils.nowUtc();
    List<String> ids = new ArrayList<>();
    ids.add(taskId);
    ids.addAll(taskMapper.selectChildIds(userId, taskId, true));
    for (String id : ids) {
      Task current = taskMapper.selectTask(userId, id);
      if (current == null || current.getDeletedAt() != null) {
        continue;
      }
      current.setDeletedAt(now);
      current.setVersion(current.getVersion() + 1);
      taskMapper.updateTask(current);
      reminderService.cancelForTask(userId, id);
      changeLogService.append(
          userId,
          "task",
          id,
          current.getVersion(),
          "delete",
          Map.of("deletedAt", TimeUtils.iso(now)),
          deviceId);
    }
  }

  @Transactional
  public TaskDtos.TaskDto restore(String userId, String deviceId, String taskId) {
    Task task = requireTaskForUpdate(userId, Ids.requireUuid(taskId, "taskId"));
    if (task.getDeletedAt() == null) {
      return toDto(task, tagIdsForTask(userId, taskId));
    }
    requireActiveList(userId, task.getListId());
    if (task.getParentId() != null) {
      Task parent = taskMapper.selectTask(userId, task.getParentId());
      if (parent != null && parent.getDeletedAt() != null) {
        throw ApiException.conflict("父任务仍在回收站，无法恢复", Map.of("parentId", parent.getId()));
      }
    }
    List<String> ids = new ArrayList<>();
    ids.add(taskId);
    ids.addAll(taskMapper.selectChildIds(userId, taskId, false));
    for (String id : ids) {
      Task current = taskMapper.selectTask(userId, id);
      if (current == null || current.getDeletedAt() == null) {
        continue;
      }
      current.setDeletedAt(null);
      current.setVersion(current.getVersion() + 1);
      taskMapper.updateTask(current);
      reminderService.rebuildForTask(current);
      Map<String, Object> restored = new LinkedHashMap<>();
      restored.put("deletedAt", null);
      changeLogService.append(userId, "task", id, current.getVersion(), "upsert", restored, deviceId);
    }
    return toDto(taskMapper.selectTask(userId, taskId), tagIdsForTask(userId, taskId));
  }

  @Transactional
  public TaskDtos.CompleteTaskResponse complete(
      String userId, String deviceId, String taskId, TaskDtos.CompleteTask input) {
    Task task = requireTaskForUpdate(userId, Ids.requireUuid(taskId, "taskId"));
    if (task.getDeletedAt() != null) {
      throw ApiException.deleted("任务已删除");
    }
    List<String> tagIds = tagIdsForTask(userId, taskId);
    if (task.getCompletedAt() != null) {
      return new TaskDtos.CompleteTaskResponse(
          toDto(task, tagIds), "already_completed", input.getCompletionId());
    }
    LocalDateTime now = TimeUtils.nowUtc();
    if (task.getRecurrenceRule() == null) {
      TaskCompletion completion = new TaskCompletion();
      completion.setId(input.getCompletionId());
      completion.setUserId(userId);
      completion.setTaskId(taskId);
      completion.setOccurrenceKey("once:" + input.getCompletionId());
      completion.setOccurrenceDueAt(task.getDueAt());
      completion.setOccurrenceDueDate(task.getDueDate());
      completion.setCompletedAt(now);
      completion.setDeviceId(deviceId);
      completion.setPreviousDueAt(task.getDueAt());
      completion.setPreviousDueDate(task.getDueDate());
      completion.setPreviousCountRemaining(task.getRecurrenceCountRemaining());
      completion.setPreviousSeq(task.getRecurrenceSeq());
      completion.setPreviousLastCompletedAt(task.getLastCompletedAt());
      taskMapper.insertCompletion(completion);
      task.setCompletedAt(now);
      task.setVersion(task.getVersion() + 1);
      taskMapper.updateTask(task);
      changeLogService.append(
          userId,
          "task",
          taskId,
          task.getVersion(),
          "upsert",
          Map.of("completedAt", TimeUtils.iso(now)),
          deviceId);
      reminderService.rebuildForTask(task);
      return new TaskDtos.CompleteTaskResponse(toDto(task, tagIds), "completed", input.getCompletionId());
    }

    String currentKey = TimeUtils.currentOccurrenceKey(task.getDueDate(), task.getDueAt());
    if (currentKey == null) {
      throw ApiException.badRequest("重复任务缺少当前实例");
    }
    if (input.getOccurrenceKey() == null || input.getOccurrenceKey().isBlank()) {
      throw ApiException.badRequest("重复任务完成需要 occurrenceKey");
    }
    TaskCompletion existing =
        taskMapper.selectCompletionByOccurrence(taskId, input.getOccurrenceKey());
    if (existing != null) {
      return new TaskDtos.CompleteTaskResponse(
          toDto(task, tagIds), "already_completed", input.getCompletionId());
    }
    if (!input.getOccurrenceKey().equals(currentKey)) {
      throw ApiException.conflict(
          "occurrenceKey 与当前实例不一致", Map.of("currentOccurrenceKey", currentKey));
    }
    NextOccurrence next = completeRecurring(task, now);
    TaskCompletion completion = new TaskCompletion();
    completion.setId(input.getCompletionId());
    completion.setUserId(userId);
    completion.setTaskId(taskId);
    completion.setOccurrenceKey(currentKey);
    completion.setOccurrenceDueAt(task.getDueAt());
    completion.setOccurrenceDueDate(task.getDueDate());
    completion.setCompletedAt(now);
    completion.setDeviceId(deviceId);
    completion.setPreviousDueAt(task.getDueAt());
    completion.setPreviousDueDate(task.getDueDate());
    completion.setPreviousCountRemaining(task.getRecurrenceCountRemaining());
    completion.setPreviousSeq(task.getRecurrenceSeq());
    completion.setPreviousLastCompletedAt(task.getLastCompletedAt());
    taskMapper.insertCompletion(completion);
    task.setDueDate(next.dueDate() == null ? null : LocalDate.parse(next.dueDate()));
    task.setDueAt(next.dueAt());
    task.setCompletedAt(next.completedAt());
    task.setLastCompletedAt(now);
    task.setRecurrenceSeq(next.seq());
    task.setRecurrenceCountRemaining(next.countRemaining());
    task.setVersion(task.getVersion() + 1);
    taskMapper.updateTask(task);
    Map<String, Object> changed = new LinkedHashMap<>();
    changed.put("dueDate", next.dueDate());
    changed.put("dueAt", next.dueAt() == null ? null : TimeUtils.iso(next.dueAt()));
    changed.put("completedAt", next.completedAt() == null ? null : TimeUtils.iso(next.completedAt()));
    changed.put("lastCompletedAt", TimeUtils.iso(now));
    changed.put("recurrenceSeq", next.seq());
    changed.put("recurrenceCountRemaining", next.countRemaining());
    changeLogService.append(userId, "task", taskId, task.getVersion(), "upsert", changed, deviceId);
    reminderService.rebuildForTask(task);
    return new TaskDtos.CompleteTaskResponse(toDto(task, tagIds), "completed", input.getCompletionId());
  }

  @Transactional
  public TaskDtos.TaskDto uncomplete(
      String userId, String deviceId, String taskId, TaskDtos.UncompleteTask input) {
    Task task = requireTaskForUpdate(userId, Ids.requireUuid(taskId, "taskId"));
    if (task.getDeletedAt() != null) {
      throw ApiException.deleted("任务已删除");
    }
    TaskCompletion completion =
        taskMapper.selectCompletion(userId, taskId, input.getCompletionId());
    if (completion == null) {
      if (task.getRecurrenceRule() == null && task.getCompletedAt() == null) {
        return toDto(task, tagIdsForTask(userId, taskId));
      }
      throw ApiException.conflict(
          "完成记录不存在或已被后续完成覆盖", Map.of("completionId", input.getCompletionId()));
    }
    TaskCompletion latest = taskMapper.selectLatestCompletion(userId, taskId);
    if (latest != null && !latest.getId().equals(completion.getId())) {
      throw ApiException.conflict(
          "只能撤销最近一次完成", Map.of("completionId", input.getCompletionId()));
    }
    taskMapper.deleteCompletion(completion.getId());
    task.setDueDate(completion.getPreviousDueDate());
    task.setDueAt(completion.getPreviousDueAt());
    task.setCompletedAt(null);
    task.setLastCompletedAt(completion.getPreviousLastCompletedAt());
    if (completion.getPreviousSeq() != null) {
      task.setRecurrenceSeq(completion.getPreviousSeq());
    }
    task.setRecurrenceCountRemaining(completion.getPreviousCountRemaining());
    task.setVersion(task.getVersion() + 1);
    taskMapper.updateTask(task);
    Map<String, Object> changed = new LinkedHashMap<>();
    changed.put("dueDate", task.getDueDate() == null ? null : task.getDueDate().toString());
    changed.put("dueAt", task.getDueAt() == null ? null : TimeUtils.iso(task.getDueAt()));
    changed.put("completedAt", null);
    changed.put("lastCompletedAt", task.getLastCompletedAt() == null ? null : TimeUtils.iso(task.getLastCompletedAt()));
    changed.put("recurrenceSeq", task.getRecurrenceSeq());
    changed.put("recurrenceCountRemaining", task.getRecurrenceCountRemaining());
    changeLogService.append(userId, "task", taskId, task.getVersion(), "upsert", changed, deviceId);
    reminderService.rebuildForTask(task);
    return toDto(task, tagIdsForTask(userId, taskId));
  }

  public TaskDtos.BatchResponse batch(String userId, String deviceId, TaskDtos.BatchTask input) {
    if (input.getTaskIds() == null || input.getTaskIds().isEmpty()) {
      throw ApiException.badRequest("taskIds 不能为空");
    }
    if (new LinkedHashSet<>(input.getTaskIds()).size() != input.getTaskIds().size()) {
      throw ApiException.badRequest("taskIds 不能重复");
    }
    if ("move".equals(input.getAction()) && input.getTargetListId() == null) {
      throw ApiException.badRequest("move 需要 targetListId");
    }
    List<TaskDtos.BatchResult> results = new ArrayList<>();
    for (String taskId : input.getTaskIds()) {
      if (!Ids.isUuid(taskId)) {
        results.add(batchRejected(taskId, "VALIDATION_ERROR", "无效的 taskId", null));
        continue;
      }
      try {
        TaskDtos.BatchResult result =
            nestedTransactionTemplate.execute(
                status -> {
                  switch (input.getAction()) {
                    case "delete" -> {
                      remove(userId, deviceId, taskId);
                      return new TaskDtos.BatchResult(taskId, "applied", null, null);
                    }
                    case "move" -> {
                      TaskDtos.UpdateTask patch = new TaskDtos.UpdateTask();
                      patch.setListId(input.getTargetListId());
                      TaskDtos.TaskDto task = update(userId, deviceId, taskId, patch, null);
                      return new TaskDtos.BatchResult(taskId, "applied", task, null);
                    }
                    default -> {
                      Task task = taskMapper.selectTask(userId, taskId);
                      if (task == null) {
                        throw ApiException.notFound("任务不存在");
                      }
                      String occurrence = TimeUtils.currentOccurrenceKey(task.getDueDate(), task.getDueAt());
                      TaskDtos.CompleteTask complete = new TaskDtos.CompleteTask();
                      complete.setOccurrenceKey(occurrence);
                      complete.setCompletionId(Ids.uuidv7());
                      TaskDtos.CompleteTaskResponse response =
                          complete(userId, deviceId, taskId, complete);
                      return new TaskDtos.BatchResult(taskId, "applied", response.task(), null);
                    }
                  }
                });
        results.add(result);
      } catch (ApiException error) {
        results.add(
            batchRejected(
                taskId,
                error.getCode().name(),
                error.getMessage(),
                error.getDetails()));
      } catch (RuntimeException error) {
        log.error("Batch task operation failed for {}", taskId, error);
        results.add(batchRejected(taskId, "INTERNAL", "处理失败", null));
      }
    }
    return new TaskDtos.BatchResponse(results);
  }

  @Transactional
  public void reorder(String userId, String deviceId, TaskDtos.ReorderTasks input) {
    List<String> ids = input.getItems().stream().map(TaskDtos.ReorderItem::getTaskId).toList();
    if (new LinkedHashSet<>(ids).size() != ids.size()) {
      throw ApiException.badRequest("taskId 不能重复");
    }
    List<Task> tasks = taskMapper.selectTasksByIds(userId, ids);
    if (tasks.size() != ids.size() || tasks.stream().anyMatch(task -> task.getDeletedAt() != null)) {
      throw ApiException.notFound("部分任务不存在");
    }
    for (TaskDtos.ReorderItem item : input.getItems()) {
      Task task = taskMapper.selectTask(userId, item.getTaskId());
      task.setSortRank(item.getSortRank());
      task.setVersion(task.getVersion() + 1);
      taskMapper.updateTask(task);
      changeLogService.append(
          userId, "task", task.getId(), task.getVersion(), "upsert", Map.of("sortRank", task.getSortRank()), deviceId);
    }
  }

  private TaskDtos.BatchResult batchRejected(
      String taskId, String code, String message, Map<String, Object> details) {
    return new TaskDtos.BatchResult(
        taskId,
        "VERSION_CONFLICT".equals(code) ? "conflict" : "rejected",
        null,
        new TaskDtos.ErrorResponse(
            new TaskDtos.ErrorBody(code, message, details, "batch")));
  }

  private NextOccurrence completeRecurring(Task task, LocalDateTime nowUtc) {
    Recurrence.ParsedRule rule = Recurrence.parse(task.getRecurrenceRule());
    ZoneId zone = TimeUtils.zone(task.getRecurrenceTimezone());
    Integer remaining = task.getRecurrenceCountRemaining();
    int seq = task.getRecurrenceSeq() == null ? 0 : task.getRecurrenceSeq();
    String dueDate = task.getDueDate() == null ? null : task.getDueDate().toString();
    LocalDateTime dueAt = task.getDueAt();
    if (remaining != null) {
      remaining -= 1;
      if (remaining <= 0) {
        return new NextOccurrence(dueDate, dueAt, nowUtc, seq + 1, 0);
      }
    }
    Recurrence.Occurrence occurrence =
        Recurrence.next(
            new Recurrence.Input(
                rule,
                zone,
                TimeUtils.toInstant(task.getRecurrenceDtstart()),
                dueDate,
                dueAt == null ? null : TimeUtils.toInstant(dueAt)));
    int guard = 0;
    while (isPast(occurrence, zone, nowUtc)) {
      if (task.getRecurrenceUntil() != null
          && occurrence.localDate().isAfter(task.getRecurrenceUntil())) {
        return new NextOccurrence(dueDate, dueAt, nowUtc, seq + 1, remaining);
      }
      if (remaining != null) {
        remaining -= 1;
        if (remaining <= 0) {
          return new NextOccurrence(dueDate, dueAt, nowUtc, seq + 1, 0);
        }
      }
      seq += 1;
      if (guard++ > 1000) {
        throw ApiException.badRequest("重复任务推进次数过多");
      }
      occurrence =
          Recurrence.next(
              new Recurrence.Input(
                  rule,
                  zone,
                  TimeUtils.toInstant(task.getRecurrenceDtstart()),
                  occurrence.dueDate(),
                  occurrence.dueAt()));
    }
    if (task.getRecurrenceUntil() != null
        && occurrence.localDate().isAfter(task.getRecurrenceUntil())) {
      return new NextOccurrence(dueDate, dueAt, nowUtc, seq + 1, remaining);
    }
    return new NextOccurrence(
        occurrence.dueDate(),
        occurrence.dueAt() == null ? null : TimeUtils.fromInstant(occurrence.dueAt()),
        null,
        seq + 1,
        remaining);
  }

  private boolean isPast(Recurrence.Occurrence occurrence, ZoneId zone, LocalDateTime nowUtc) {
    if (occurrence.dueAt() != null) {
      return !occurrence.dueAt().isAfter(TimeUtils.toInstant(nowUtc));
    }
    return occurrence.localDate().isBefore(TimeUtils.localDateOf(TimeUtils.toInstant(nowUtc), zone));
  }

  private Task requireTask(String userId, String taskId, boolean includeDeleted) {
    Task task = taskMapper.selectTask(userId, Ids.requireUuid(taskId, "taskId"));
    if (task == null || (!includeDeleted && task.getDeletedAt() != null)) {
      throw ApiException.notFound("任务不存在");
    }
    return task;
  }

  private Task requireTaskForUpdate(String userId, String taskId) {
    Task task = taskMapper.selectTaskForUpdate(userId, taskId);
    if (task == null) {
      throw ApiException.notFound("任务不存在");
    }
    return task;
  }

  private void requireActiveList(String userId, String listId) {
    if (listId == null || listMapper.selectList(userId, listId) == null) {
      throw ApiException.badRequest("清单不存在", Map.of("listId", String.valueOf(listId)));
    }
  }

  private TodoList inbox(String userId) {
    TodoList inbox = listMapper.selectInbox(userId);
    if (inbox == null) {
      throw new IllegalStateException("Default inbox is missing");
    }
    return inbox;
  }

  private Due normalizeDue(LocalDate dueDate, Instant dueAt) {
    if (dueDate != null && dueAt != null) {
      throw ApiException.badRequest("dueDate 与 dueAt 不能同时设置");
    }
    return new Due(dueDate, dueAt == null ? null : TimeUtils.fromInstant(dueAt));
  }

  private Due mergeDue(Task task, TaskDtos.UpdateTask input) {
    LocalDate dueDate = input.isDueDatePresent() ? input.getDueDate() : task.getDueDate();
    LocalDateTime dueAt = input.isDueAtPresent()
        ? (input.getDueAt() == null ? null : TimeUtils.fromInstant(input.getDueAt()))
        : task.getDueAt();
    if (input.isDueDatePresent() && dueDate != null && !input.isDueAtPresent()) {
      dueAt = null;
    }
    if (input.isDueAtPresent() && dueAt != null && !input.isDueDatePresent()) {
      dueDate = null;
    }
    if (dueDate != null && dueAt != null) {
      throw ApiException.badRequest("dueDate 与 dueAt 不能同时设置");
    }
    return new Due(dueDate, dueAt);
  }

  private record Due(LocalDate dueDate, LocalDateTime dueAt) {}

  private record ParsedRecurrence(
      Recurrence.ParsedRule rule,
      String timezone,
      LocalDateTime dtstart,
      LocalDate until,
      Integer countRemaining,
      int seq) {}

  private ParsedRecurrence parseRecurrence(TaskDtos.RecurrenceInput input) {
    Recurrence.ParsedRule rule = Recurrence.parse(input.getRule());
    TimeUtils.zone(input.getTimezone());
    if (input.getDtstart() == null) {
      throw ApiException.badRequest("recurrence.dtstart 不能为空");
    }
    return new ParsedRecurrence(
        rule,
        input.getTimezone(),
        TimeUtils.fromInstant(input.getDtstart()),
        input.getUntil(),
        input.getCountRemaining(),
        input.getSeq() == null ? 0 : input.getSeq());
  }

  private void applyRecurrence(Task task, ParsedRecurrence recurrence) {
    if (recurrence == null) {
      task.setRecurrenceRule(null);
      task.setRecurrenceDtstart(null);
      task.setRecurrenceUntil(null);
      task.setRecurrenceCountRemaining(null);
      task.setRecurrenceSeq(0);
      task.setRecurrenceTimezone(null);
      return;
    }
    task.setRecurrenceRule(recurrence.rule().canonical());
    task.setRecurrenceDtstart(recurrence.dtstart());
    task.setRecurrenceUntil(recurrence.until());
    task.setRecurrenceCountRemaining(recurrence.countRemaining());
    task.setRecurrenceSeq(recurrence.seq());
    task.setRecurrenceTimezone(recurrence.timezone());
  }

  private void validateTags(String userId, List<String> tagIds) {
    for (String tagId : new LinkedHashSet<>(tagIds)) {
      if (!Ids.isUuid(tagId)) {
        throw ApiException.badRequest("无效的标签 ID", Map.of("tagId", String.valueOf(tagId)));
      }
      Tag tag = tagMapper.selectTag(userId, tagId);
      if (tag == null) {
        throw ApiException.badRequest("标签不存在");
      }
    }
  }

  private List<String> tagIdsForTask(String userId, String taskId) {
    return taskMapper.selectTagLinks(userId, List.of(taskId)).stream()
        .map(TaskTagLink::getTagId)
        .toList();
  }

  private Map<String, List<String>> tagsFor(String userId, List<Task> tasks) {
    if (tasks.isEmpty()) {
      return Map.of();
    }
    Map<String, List<String>> tags = new LinkedHashMap<>();
    for (TaskTagLink link :
        taskMapper.selectTagLinks(userId, tasks.stream().map(Task::getId).toList())) {
      tags.computeIfAbsent(link.getTaskId(), ignored -> new ArrayList<>()).add(link.getTagId());
    }
    return tags;
  }

  private TaskDtos.TaskDto toDto(Task task, List<String> tagIds) {
    return TaskDtos.from(task, tagIds, parseReminderSpecs(task.getReminderSpec()));
  }

  private List<TaskDtos.ReminderSpecDto> parseReminderSpecs(String json) {
    if (json == null || json.isBlank()) {
      return List.of();
    }
    try {
      return objectMapper.readValue(json, new TypeReference<List<TaskDtos.ReminderSpecDto>>() {});
    } catch (Exception error) {
      log.warn("Invalid reminderSpec JSON", error);
      return List.of();
    }
  }

  private String writeReminderSpecs(List<TaskDtos.ReminderSpecDto> specs) {
    try {
      return objectMapper.writeValueAsString(specs == null ? List.of() : specs);
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  private Map<String, Object> toDtoMap(Task task, List<String> tagIds) {
    return toMap(toDto(task, tagIds));
  }

  private Map<String, Object> toMap(Object value) {
    return objectMapper.convertValue(value, new TypeReference<LinkedHashMap<String, Object>>() {});
  }

  private void appendTaskChange(
      String userId,
      String deviceId,
      Task task,
      List<String> tagIds,
      String op,
      Map<String, Object> changedFields) {
    changeLogService.append(userId, "task", task.getId(), task.getVersion(), op, changedFields, deviceId);
  }

  private String orderKind(TaskDtos.ListQuery query) {
    if ("completed".equals(query.view())) {
      return "completed";
    }
    if ("trash".equals(query.view())) {
      return "deleted";
    }
    if (query.q() != null && !query.q().isBlank()) {
      return "updated";
    }
    return "rank";
  }

  private String cursorKeyValue(String orderKind, Task task, ZoneId zone) {
    return switch (orderKind) {
      case "completed" -> mysqlDateTime(task.getCompletedAt());
      case "deleted" -> mysqlDateTime(task.getDeletedAt());
      case "updated" -> mysqlDateTime(task.getUpdatedAt());
      default -> task.getSortRank();
    };
  }

  private String cursorKeyValue(String orderKind, CursorValue cursor, ZoneId zone) {
    return cursor.k();
  }

  private static String mysqlDateTime(LocalDateTime value) {
    return value == null
        ? null
        : value.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS"));
  }

  private record LocalDateDayBounds(LocalDateTime start, LocalDateTime end) {}

  private LocalDateDayBounds bounds(ZoneId zone, LocalDate date) {
    Instant start = TimeUtils.zonedWallTimeToInstant(zone, date, 0, 0);
    Instant end = TimeUtils.zonedWallTimeToInstant(zone, date.plusDays(1), 0, 0);
    return new LocalDateDayBounds(TimeUtils.fromInstant(start), TimeUtils.fromInstant(end));
  }

  private String encodeCursor(CursorValue cursor) {
    try {
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(objectMapper.writeValueAsString(cursor).getBytes(StandardCharsets.UTF_8));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  private CursorValue decodeCursor(String value) {
    try {
      String json =
          new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
      CursorValue cursor = objectMapper.readValue(json, CursorValue.class);
      if (cursor == null || cursor.k() == null || !Ids.isUuid(cursor.id())) {
        throw new IllegalArgumentException("invalid cursor");
      }
      return cursor;
    } catch (Exception error) {
      throw ApiException.badRequest("无效的分页游标");
    }
  }
}
