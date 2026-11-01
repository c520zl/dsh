package com.todoapp.me;

import com.todoapp.auth.dto.UserDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import lombok.Data;

public final class MeDtos {
  private MeDtos() {}

  public record SettingsDto(
      String theme,
      String accent,
      String weekStart,
      String defaultListId,
      String defaultReminderTime,
      String timeFormat,
      QuietHours quietHours,
      Map<String, Boolean> notificationPrefs,
      long version) {}

  public record QuietHours(String start, String end) {}

  public record MeResponse(UserDto user, SettingsDto settings) {}

  public record DeleteAccountResponse(String status, String deleteAfter) {}

  @Data
  public static class UpdateMe {
    @Size(min = 1, max = 50)
    private String displayName;

    @Size(max = 64)
    private String avatar;

    @Size(max = 64)
    private String timezone;

    @Pattern(regexp = "zh-CN|en")
    private String locale;

    @Valid
    private UpdateSettings settings;
  }

  @Data
  public static class UpdateSettings {
    @Pattern(regexp = "system|light|dark")
    private String theme;

    @Pattern(regexp = "coral|teal|amber|indigo")
    private String accent;

    @Pattern(regexp = "monday|sunday")
    private String weekStart;

    private String defaultListId;

    @Pattern(regexp = "([01][0-9]|2[0-3]):[0-5][0-9]")
    private String defaultReminderTime;

    @Pattern(regexp = "12h|24h")
    private String timeFormat;

    @Valid
    private QuietHoursUpdate quietHours;

    private Map<String, Boolean> notificationPrefs;
  }

  @Data
  public static class QuietHoursUpdate {
    @Pattern(regexp = "([01][0-9]|2[0-3]):[0-5][0-9]")
    private String start;

    @Pattern(regexp = "([01][0-9]|2[0-3]):[0-5][0-9]")
    private String end;
  }
}
