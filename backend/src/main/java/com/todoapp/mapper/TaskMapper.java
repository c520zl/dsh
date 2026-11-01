package com.todoapp.mapper;

import com.todoapp.task.Task;
import com.todoapp.task.TaskCompletion;
import com.todoapp.task.TaskTagLink;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface TaskMapper {
  Task selectTask(@Param("userId") String userId, @Param("id") String id);

  Task selectTaskForUpdate(@Param("userId") String userId, @Param("id") String id);

  List<Task> listTasks(
      @Param("userId") String userId,
      @Param("view") String view,
      @Param("listId") String listId,
      @Param("status") String status,
      @Param("q") String q,
      @Param("dueFrom") LocalDate dueFrom,
      @Param("dueTo") LocalDate dueTo,
      @Param("todayDate") LocalDate todayDate,
      @Param("dayStart") LocalDateTime dayStart,
      @Param("dayEnd") LocalDateTime dayEnd,
      @Param("tomorrowStart") LocalDateTime tomorrowStart,
      @Param("windowEndDate") LocalDate windowEndDate,
      @Param("windowEndStart") LocalDateTime windowEndStart,
      @Param("completedCutoff") LocalDateTime completedCutoff,
      @Param("trashCutoff") LocalDateTime trashCutoff,
      @Param("cursorKey") String cursorKey,
      @Param("cursorId") String cursorId,
      @Param("orderKind") String orderKind,
      @Param("limit") int limit);

  List<Task> selectTasksByIds(
      @Param("userId") String userId, @Param("ids") List<String> ids);

  List<Task> selectTasksWithReminders(@Param("userId") String userId);

  List<Task> selectTasksForExport(@Param("userId") String userId);

  List<Task> selectActiveTasksInList(
      @Param("userId") String userId, @Param("listId") String listId);

  List<Task> selectTasksByTag(
      @Param("userId") String userId, @Param("tagId") String tagId);

  int deleteTagLinks(
      @Param("userId") String userId, @Param("tagId") String tagId);

  List<String> selectChildIds(
      @Param("userId") String userId,
      @Param("parentId") String parentId,
      @Param("onlyActive") boolean onlyActive);

  int insertTask(Task task);

  int updateTask(Task task);

  int softDeleteTask(
      @Param("id") String id,
      @Param("deletedAt") LocalDateTime deletedAt,
      @Param("version") long version);

  int updateTaskList(
      @Param("id") String id, @Param("listId") String listId, @Param("version") long version);

  int updateTaskSort(
      @Param("id") String id, @Param("sortRank") String sortRank, @Param("version") long version);

  List<TaskTagLink> selectTagLinks(
      @Param("userId") String userId, @Param("taskIds") List<String> taskIds);

  int deleteTaskTags(@Param("userId") String userId, @Param("taskId") String taskId);

  int insertTaskTag(
      @Param("userId") String userId,
      @Param("taskId") String taskId,
      @Param("tagId") String tagId);

  TaskCompletion selectCompletionByOccurrence(
      @Param("taskId") String taskId, @Param("occurrenceKey") String occurrenceKey);

  TaskCompletion selectCompletion(
      @Param("userId") String userId,
      @Param("taskId") String taskId,
      @Param("id") String id);

  TaskCompletion selectLatestCompletion(
      @Param("userId") String userId, @Param("taskId") String taskId);

  int insertCompletion(TaskCompletion completion);

  int deleteCompletion(@Param("id") String id);

  int countTagForUser(@Param("userId") String userId, @Param("tagId") String tagId);

  int deleteTrashBefore(@Param("before") LocalDateTime before);
}
