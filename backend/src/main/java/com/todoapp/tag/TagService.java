package com.todoapp.tag;

import com.todoapp.common.ApiException;
import com.todoapp.common.Ids;
import com.todoapp.common.TimeUtils;
import com.todoapp.mapper.TagMapper;
import com.todoapp.mapper.TaskMapper;
import com.todoapp.sync.ChangeLogService;
import com.todoapp.task.Task;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TagService {
  private final TagMapper tagMapper;
  private final TaskMapper taskMapper;
  private final ChangeLogService changeLogService;

  public TagService(TagMapper tagMapper, TaskMapper taskMapper, ChangeLogService changeLogService) {
    this.tagMapper = tagMapper;
    this.taskMapper = taskMapper;
    this.changeLogService = changeLogService;
  }

  public List<TagDtos.TagDto> list(String userId) {
    return tagMapper.selectTags(userId).stream().map(TagDtos.TagDto::from).toList();
  }

  @Transactional
  public TagDtos.TagDto create(String userId, String deviceId, TagDtos.CreateTag input) {
    String name = input.getName().trim();
    if (name.isEmpty()) {
      throw ApiException.badRequest("标签名称不能为空");
    }
    String id = input.getId() == null ? Ids.uuidv7() : Ids.requireUuid(input.getId(), "id");
    Tag existing = tagMapper.selectTag(userId, id);
    if (existing != null) {
      return TagDtos.TagDto.from(existing);
    }
    if (tagMapper.countByActiveName(userId, name, null) > 0) {
      throw ApiException.badRequest("同名标签已存在", Map.of("name", name));
    }
    Tag tag = new Tag();
    tag.setId(id);
    tag.setUserId(userId);
    tag.setName(name);
    tag.setColor(input.getColor() == null ? "slate" : input.getColor());
    tag.setVersion(1L);
    tagMapper.insertTag(tag);
    Tag created = tagMapper.selectTag(userId, id);
    Map<String, Object> fields = new LinkedHashMap<>();
    fields.put("id", created.getId());
    fields.put("name", created.getName());
    fields.put("color", created.getColor());
    fields.put("version", created.getVersion());
    fields.put("createdAt", TimeUtils.iso(created.getCreatedAt()));
    fields.put("updatedAt", TimeUtils.iso(created.getUpdatedAt()));
    changeLogService.append(userId, "tag", id, created.getVersion(), "upsert", fields, deviceId);
    return TagDtos.TagDto.from(created);
  }

  @Transactional
  public TagDtos.TagDto update(String userId, String deviceId, String tagId, TagDtos.UpdateTag input) {
    Tag tag = tagMapper.selectTag(userId, Ids.requireUuid(tagId, "tagId"));
    if (tag == null) {
      throw ApiException.notFound("标签不存在");
    }
    Map<String, Object> changed = new LinkedHashMap<>();
    if (input.getName() != null) {
      String name = input.getName().trim();
      if (name.isEmpty()) {
        throw ApiException.badRequest("标签名称不能为空");
      }
      if (!name.equalsIgnoreCase(tag.getName()) && tagMapper.countByActiveName(userId, name, tagId) > 0) {
        throw ApiException.badRequest("同名标签已存在", Map.of("name", name));
      }
      if (!name.equals(tag.getName())) {
        tag.setName(name);
        changed.put("name", name);
      }
    }
    if (input.getColor() != null && !input.getColor().equals(tag.getColor())) {
      tag.setColor(input.getColor());
      changed.put("color", input.getColor());
    }
    if (changed.isEmpty()) {
      return TagDtos.TagDto.from(tag);
    }
    tag.setVersion(tag.getVersion() + 1);
    tagMapper.updateTag(tag);
    changeLogService.append(userId, "tag", tagId, tag.getVersion(), "upsert", changed, deviceId);
    return TagDtos.TagDto.from(tagMapper.selectTag(userId, tagId));
  }

  @Transactional
  public void delete(String userId, String deviceId, String tagId) {
    Tag tag = tagMapper.selectTag(userId, Ids.requireUuid(tagId, "tagId"));
    if (tag == null) {
      throw ApiException.notFound("标签不存在");
    }
    List<Task> affected = taskMapper.selectTasksByTag(userId, tagId);
    taskMapper.deleteTagLinks(userId, tagId);
    for (Task task : affected) {
      task.setVersion(task.getVersion() + 1);
      taskMapper.updateTask(task);
      List<String> remaining =
          taskMapper.selectTagLinks(userId, List.of(task.getId())).stream()
              .map(com.todoapp.task.TaskTagLink::getTagId)
              .toList();
      changeLogService.append(
          userId, "task", task.getId(), task.getVersion(), "upsert", Map.of("tagIds", remaining), deviceId);
    }
    var now = TimeUtils.nowUtc();
    tag.setDeletedAt(now);
    tag.setVersion(tag.getVersion() + 1);
    tagMapper.updateTag(tag);
    changeLogService.append(
        userId, "tag", tagId, tag.getVersion(), "delete", Map.of("deletedAt", TimeUtils.iso(now)), deviceId);
  }
}
