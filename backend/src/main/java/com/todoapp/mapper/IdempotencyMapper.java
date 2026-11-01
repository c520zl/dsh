package com.todoapp.mapper;

import org.apache.ibatis.annotations.Param;

public interface IdempotencyMapper {
  int insertPlaceholder(
      @Param("userId") String userId, @Param("key") String key);

  int updateResponse(
      @Param("userId") String userId,
      @Param("key") String key,
      @Param("response") String response);

  String selectResponse(
      @Param("userId") String userId, @Param("key") String key);

  String selectResponseForUpdate(
      @Param("userId") String userId, @Param("key") String key);

  int deleteBefore(@Param("before") java.time.LocalDateTime before);
}
