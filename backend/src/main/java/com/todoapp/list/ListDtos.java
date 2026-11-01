package com.todoapp.list;

import com.todoapp.common.TimeUtils;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

public final class ListDtos {
  private ListDtos() {}

  public record ListDto(
      String id,
      String name,
      String color,
      String icon,
      String sortRank,
      boolean isArchived,
      boolean isDefault,
      long version,
      String createdAt,
      String updatedAt) {
    public static ListDto from(TodoList list) {
      return new ListDto(
          list.getId(),
          list.getName(),
          list.getColor(),
          list.getIcon(),
          list.getSortRank(),
          Boolean.TRUE.equals(list.getIsArchived()),
          Boolean.TRUE.equals(list.getIsDefault()),
          list.getVersion(),
          list.getCreatedAt() == null ? null : TimeUtils.iso(list.getCreatedAt()),
          list.getUpdatedAt() == null ? null : TimeUtils.iso(list.getUpdatedAt()));
    }
  }

  @Data
  public static class CreateList {
    private String id;

    @NotBlank
    @Size(max = 50)
    private String name;

    @Size(max = 32)
    private String color;

    @Size(max = 32)
    private String icon;

    @Size(max = 128)
    private String sortRank;
  }

  @Data
  public static class UpdateList {
    @Size(min = 1, max = 50)
    private String name;

    @Size(max = 32)
    private String color;

    @Size(max = 32)
    private String icon;

    @Size(max = 128)
    private String sortRank;

    private Boolean isArchived;
  }

  @Data
  public static class DeleteList {
    private String taskAction = "move_to_inbox";
  }
}
