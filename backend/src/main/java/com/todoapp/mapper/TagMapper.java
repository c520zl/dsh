package com.todoapp.mapper;

import com.todoapp.tag.Tag;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface TagMapper {
  List<Tag> selectTags(@Param("userId") String userId);

  Tag selectTag(@Param("userId") String userId, @Param("id") String id);

  int countByActiveName(
      @Param("userId") String userId,
      @Param("name") String name,
      @Param("excludeId") String excludeId);

  int insertTag(Tag tag);

  int updateTag(Tag tag);
}
