package com.todoapp.mapper;

import com.todoapp.list.TodoList;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface ListMapper {
  List<TodoList> selectLists(
      @Param("userId") String userId, @Param("includeArchived") boolean includeArchived);

  TodoList selectList(@Param("userId") String userId, @Param("id") String id);

  TodoList selectListIncludingDeleted(
      @Param("userId") String userId, @Param("id") String id);

  TodoList selectInbox(@Param("userId") String userId);

  int countActiveLists(@Param("userId") String userId);

  int countByActiveName(
      @Param("userId") String userId,
      @Param("name") String name,
      @Param("excludeId") String excludeId);

  int insertList(TodoList list);

  int updateList(TodoList list);

  int updateDefaultList(
      @Param("userId") String userId, @Param("defaultListId") String defaultListId);
}
