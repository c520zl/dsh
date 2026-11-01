package com.todoapp.tag;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("todo_tags")
public class Tag {
  @TableId(type = IdType.INPUT)
  private String id;
  private String userId;
  private String name;
  private String color;
  private Long version;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;
  private LocalDateTime deletedAt;
}
