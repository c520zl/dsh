package com.todoapp.tag;

import com.todoapp.common.TimeUtils;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

public final class TagDtos {
  private TagDtos() {}

  public record TagDto(
      String id, String name, String color, long version, String createdAt, String updatedAt) {
    public static TagDto from(Tag tag) {
      return new TagDto(
          tag.getId(),
          tag.getName(),
          tag.getColor(),
          tag.getVersion(),
          tag.getCreatedAt() == null ? null : TimeUtils.iso(tag.getCreatedAt()),
          tag.getUpdatedAt() == null ? null : TimeUtils.iso(tag.getUpdatedAt()));
    }
  }

  @Data
  public static class CreateTag {
    private String id;

    @NotBlank
    @Size(max = 30)
    private String name;

    @Size(max = 32)
    private String color;
  }

  @Data
  public static class UpdateTag {
    @Size(min = 1, max = 30)
    private String name;

    @Size(max = 32)
    private String color;
  }
}
