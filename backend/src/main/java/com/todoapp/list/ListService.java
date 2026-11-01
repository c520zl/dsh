package com.todoapp.list;

import com.todoapp.common.ApiException;
import com.todoapp.common.Ids;
import com.todoapp.common.SortRanks;
import com.todoapp.common.TimeUtils;
import com.todoapp.mapper.ListMapper;
import com.todoapp.mapper.ReminderMapper;
import com.todoapp.mapper.TaskMapper;
import com.todoapp.me.UserSettings;
import com.todoapp.sync.ChangeLogService;
import com.todoapp.task.Task;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ListService {
  private final ListMapper listMapper;
  private final TaskMapper taskMapper;
  private final ReminderMapper reminderMapper;
  private final ChangeLogService changeLogService;
  private final com.todoapp.mapper.IdentityMapper identityMapper;

  public ListService(
      ListMapper listMapper,
      TaskMapper taskMapper,
      ReminderMapper reminderMapper,
      ChangeLogService changeLogService,
      com.todoapp.mapper.IdentityMapper identityMapper) {
    this.listMapper = listMapper;
    this.taskMapper = taskMapper;
    this.reminderMapper = reminderMapper;
    this.changeLogService = changeLogService;
    this.identityMapper = identityMapper;
  }

  public List<ListDtos.ListDto> list(String userId, boolean includeArchived) {
    return listMapper.selectLists(userId, includeArchived).stream().map(ListDtos.ListDto::from).toList();
  }

  @Transactional
  public ListDtos.ListDto create(String userId, String deviceId, ListDtos.CreateList input) {
    String name = input.getName().trim();
    if (name.isEmpty()) {
      throw ApiException.badRequest("清单名称不能为空");
    }
    String id = input.getId() == null ? Ids.uuidv7() : Ids.requireUuid(input.getId(), "id");
    TodoList existing = listMapper.selectListIncludingDeleted(userId, id);
    if (existing != null) {
      if (existing.getDeletedAt() != null) {
        throw ApiException.badRequest("清单 ID 已被使用");
      }
      return ListDtos.ListDto.from(existing);
    }
    if (listMapper.countActiveLists(userId) >= 500) {
      throw ApiException.badRequest("清单数量已达上限（500）");
    }
    if (listMapper.countByActiveName(userId, name, null) > 0) {
      throw ApiException.badRequest("同名清单已存在", Map.of("name", name));
    }
    TodoList list = new TodoList();
    list.setId(id);
    list.setUserId(userId);
    list.setName(name);
    list.setColor(input.getColor() == null ? "coral" : input.getColor());
    list.setIcon(input.getIcon() == null ? "list" : input.getIcon());
    list.setSortRank(input.getSortRank() == null ? SortRanks.newListSortRank() : input.getSortRank());
    list.setIsArchived(false);
    list.setIsDefault(false);
    list.setVersion(1L);
    listMapper.insertList(list);
    TodoList created = listMapper.selectList(userId, id);
    Map<String, Object> fields = new LinkedHashMap<>();
    fields.put("id", created.getId());
    fields.put("name", created.getName());
    fields.put("color", created.getColor());
    fields.put("icon", created.getIcon());
    fields.put("sortRank", created.getSortRank());
    fields.put("isArchived", false);
    fields.put("isDefault", false);
    fields.put("version", created.getVersion());
    fields.put("createdAt", TimeUtils.iso(created.getCreatedAt()));
    fields.put("updatedAt", TimeUtils.iso(created.getUpdatedAt()));
    changeLogService.append(userId, "list", id, created.getVersion(), "upsert", fields, deviceId);
    return ListDtos.ListDto.from(created);
  }

  @Transactional
  public ListDtos.ListDto update(String userId, String deviceId, String listId, ListDtos.UpdateList input) {
    TodoList list = listMapper.selectList(userId, Ids.requireUuid(listId, "listId"));
    if (list == null) {
      throw ApiException.notFound("清单不存在");
    }
    Map<String, Object> changed = new LinkedHashMap<>();
    if (input.getName() != null) {
      String name = input.getName().trim();
      if (name.isEmpty()) {
        throw ApiException.badRequest("清单名称不能为空");
      }
      if (!name.equalsIgnoreCase(list.getName()) && listMapper.countByActiveName(userId, name, listId) > 0) {
        throw ApiException.badRequest("同名清单已存在", Map.of("name", name));
      }
      if (!name.equals(list.getName())) {
        list.setName(name);
        changed.put("name", name);
      }
    }
    if (input.getColor() != null && !input.getColor().equals(list.getColor())) {
      list.setColor(input.getColor());
      changed.put("color", input.getColor());
    }
    if (input.getIcon() != null && !input.getIcon().equals(list.getIcon())) {
      list.setIcon(input.getIcon());
      changed.put("icon", input.getIcon());
    }
    if (input.getSortRank() != null && !input.getSortRank().equals(list.getSortRank())) {
      list.setSortRank(input.getSortRank());
      changed.put("sortRank", input.getSortRank());
    }
    if (input.getIsArchived() != null && !input.getIsArchived().equals(list.getIsArchived())) {
      list.setIsArchived(input.getIsArchived());
      changed.put("isArchived", input.getIsArchived());
    }
    if (changed.isEmpty()) {
      return ListDtos.ListDto.from(list);
    }
    list.setVersion(list.getVersion() + 1);
    listMapper.updateList(list);
    changeLogService.append(userId, "list", listId, list.getVersion(), "upsert", changed, deviceId);
    return ListDtos.ListDto.from(listMapper.selectList(userId, listId));
  }

  @Transactional
  public void delete(String userId, String deviceId, String listId, ListDtos.DeleteList input) {
    TodoList list = listMapper.selectList(userId, Ids.requireUuid(listId, "listId"));
    if (list == null) {
      throw ApiException.notFound("清单不存在");
    }
    if (Boolean.TRUE.equals(list.getIsDefault())) {
      throw ApiException.badRequest("收件箱不可删除");
    }
    TodoList inbox = listMapper.selectInbox(userId);
    if (inbox == null) {
      throw new IllegalStateException("Default inbox is missing");
    }
    String action = input == null || input.getTaskAction() == null ? "move_to_inbox" : input.getTaskAction();
    if (!action.equals("move_to_inbox") && !action.equals("delete_tasks")) {
      throw ApiException.badRequest("无效的任务去向");
    }
    LocalDateTime now = TimeUtils.nowUtc();
    for (Task task : taskMapper.selectActiveTasksInList(userId, listId)) {
      if (action.equals("move_to_inbox")) {
        task.setListId(inbox.getId());
        task.setVersion(task.getVersion() + 1);
        taskMapper.updateTask(task);
        changeLogService.append(
            userId, "task", task.getId(), task.getVersion(), "upsert", Map.of("listId", inbox.getId()), deviceId);
      } else {
        task.setDeletedAt(now);
        task.setVersion(task.getVersion() + 1);
        taskMapper.updateTask(task);
        reminderMapper.cancelForTask(userId, task.getId());
        changeLogService.append(
            userId,
            "task",
            task.getId(),
            task.getVersion(),
            "delete",
            Map.of("deletedAt", TimeUtils.iso(now)),
            deviceId);
      }
    }
    list.setDeletedAt(now);
    list.setVersion(list.getVersion() + 1);
    listMapper.updateList(list);
    changeLogService.append(
        userId, "list", listId, list.getVersion(), "delete", Map.of("deletedAt", TimeUtils.iso(now)), deviceId);
    UserSettings settings = identityMapper.selectSettings(userId);
    if (settings != null && listId.equals(settings.getDefaultListId())) {
      listMapper.updateDefaultList(userId, inbox.getId());
    }
  }
}
