package com.todoapp.list;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("todo_lists")
public class TodoList {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String name;
  private String color;
  private String icon;
  private String sortRank;
  private Boolean isArchived;
  private Boolean isDefault;
  private Long version;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;
  private LocalDateTime deletedAt;
}
