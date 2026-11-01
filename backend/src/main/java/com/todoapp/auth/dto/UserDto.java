package com.todoapp.auth.dto;

import com.todoapp.auth.User;
import com.todoapp.common.TimeUtils;

public record UserDto(
    String id,
    String email,
    String displayName,
    String avatar,
    String timezone,
    String locale,
    String createdAt) {
  public static UserDto from(User user) {
    return new UserDto(
        user.getId(),
        user.getEmail(),
        user.getDisplayName(),
        user.getAvatar(),
        user.getTimezone(),
        user.getLocale(),
        user.getCreatedAt() == null ? null : TimeUtils.iso(user.getCreatedAt()));
  }
}
