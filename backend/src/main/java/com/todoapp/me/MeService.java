package com.todoapp.me;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.auth.AuditService;
import com.todoapp.auth.User;
import com.todoapp.auth.dto.UserDto;
import com.todoapp.common.ApiException;
import com.todoapp.common.TimeUtils;
import com.todoapp.config.AppProperties;
import com.todoapp.list.TodoList;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.ListMapper;
import com.todoapp.reminder.ReminderService;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MeService {
  private final IdentityMapper identityMapper;
  private final ListMapper listMapper;
  private final AuditService audit;
  private final AppProperties properties;
  private final ObjectMapper objectMapper;
  private final ReminderService reminderService;

  public MeService(
      IdentityMapper identityMapper,
      ListMapper listMapper,
      AuditService audit,
      AppProperties properties,
      ObjectMapper objectMapper,
      ReminderService reminderService) {
    this.identityMapper = identityMapper;
    this.listMapper = listMapper;
    this.audit = audit;
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.reminderService = reminderService;
  }

  public MeDtos.MeResponse get(String userId) {
    User user = identityMapper.selectUserById(userId);
    if (user == null || user.getDeletedAt() != null) {
      throw ApiException.notFound("用户不存在");
    }
    UserSettings settings = identityMapper.selectSettings(userId);
    if (settings == null) {
      throw ApiException.notFound("用户设置不存在");
    }
    return new MeDtos.MeResponse(UserDto.from(user), toDto(settings));
  }

  @Transactional
  public MeDtos.MeResponse update(String userId, MeDtos.UpdateMe input) {
    User user = identityMapper.selectUserById(userId);
    if (user == null || user.getDeletedAt() != null) {
      throw ApiException.notFound("用户不存在");
    }
    UserSettings settings = identityMapper.selectSettings(userId);
    if (settings == null) {
      throw ApiException.notFound("用户设置不存在");
    }
    boolean timezoneChanged = false;
    if (input.getTimezone() != null) {
      TimeUtils.zone(input.getTimezone());
      timezoneChanged = !input.getTimezone().equals(user.getTimezone());
      user.setTimezone(input.getTimezone());
    }
    if (input.getDisplayName() != null) {
      String display = input.getDisplayName().trim();
      if (display.isEmpty()) {
        throw ApiException.badRequest("昵称不能为空");
      }
      user.setDisplayName(display);
    }
    if (input.getAvatar() != null) {
      user.setAvatar(input.getAvatar());
    }
    if (input.getLocale() != null) {
      user.setLocale(input.getLocale());
    }
    identityMapper.updateUser(user);

    MeDtos.UpdateSettings patch = input.getSettings();
    if (patch != null) {
      if (patch.getDefaultListId() != null) {
        TodoList list = listMapper.selectList(userId, patch.getDefaultListId());
        if (list == null) {
          throw ApiException.badRequest("默认清单不存在");
        }
        settings.setDefaultListId(patch.getDefaultListId());
      }
      if (patch.getTheme() != null) {
        settings.setTheme(patch.getTheme());
      }
      if (patch.getAccent() != null) {
        settings.setAccent(patch.getAccent());
      }
      if (patch.getWeekStart() != null) {
        settings.setWeekStart(patch.getWeekStart());
      }
      if (patch.getDefaultReminderTime() != null) {
        settings.setDefaultReminderTime(LocalTime.parse(patch.getDefaultReminderTime()));
      }
      if (patch.getTimeFormat() != null) {
        settings.setTimeFormat(patch.getTimeFormat());
      }
      if (patch.getQuietHours() != null) {
        if (patch.getQuietHours().getStart() == null || patch.getQuietHours().getEnd() == null) {
          throw ApiException.badRequest("免打扰时段必须同时提供开始和结束时间");
        }
        settings.setQuietHoursStart(LocalTime.parse(patch.getQuietHours().getStart()));
        settings.setQuietHoursEnd(LocalTime.parse(patch.getQuietHours().getEnd()));
      }
      if (patch.getNotificationPrefs() != null) {
        settings.setNotificationPrefs(writeJson(patch.getNotificationPrefs()));
      }
      settings.setVersion(settings.getVersion() + 1);
      identityMapper.updateSettings(settings);
    }
    if (timezoneChanged) {
      reminderService.rebuildForUser(userId);
    }
    User refreshed = identityMapper.selectUserById(userId);
    return new MeDtos.MeResponse(
        UserDto.from(refreshed), toDto(identityMapper.selectSettings(userId)));
  }

  @Transactional
  public MeDtos.DeleteAccountResponse delete(String userId, String ip) {
    User user = identityMapper.selectUserById(userId);
    if (user == null || user.getDeletedAt() != null) {
      throw ApiException.notFound("用户不存在");
    }
    var now = TimeUtils.nowUtc();
    identityMapper.softDeleteUser(userId, now);
    identityMapper.updateUserAuthVersion(userId, user.getAuthVersion() + 1);
    identityMapper.revokeAllTokensForUser(userId, now);
    for (var device : identityMapper.selectDevices(userId, false)) {
      device.setAuthVersion(device.getAuthVersion() + 1);
      device.setPushToken(null);
      device.setPushProvider(null);
      device.setRevokedAt(now);
      identityMapper.updateDevice(device);
    }
    audit.record(userId, "account_deletion_requested", ip, Map.of());
    return new MeDtos.DeleteAccountResponse(
        "deletion_scheduled",
        TimeUtils.iso(now.plusDays(properties.getRetention().getUserDeletionDays())));
  }

  private MeDtos.SettingsDto toDto(UserSettings settings) {
    MeDtos.QuietHours quiet =
        settings.getQuietHoursStart() == null || settings.getQuietHoursEnd() == null
            ? null
            : new MeDtos.QuietHours(
                formatTime(settings.getQuietHoursStart()), formatTime(settings.getQuietHoursEnd()));
    return new MeDtos.SettingsDto(
        settings.getTheme(),
        settings.getAccent(),
        settings.getWeekStart(),
        settings.getDefaultListId(),
        formatTime(settings.getDefaultReminderTime()),
        settings.getTimeFormat(),
        quiet,
        readJson(settings.getNotificationPrefs()),
        settings.getVersion());
  }

  private static String formatTime(LocalTime time) {
    return time == null ? null : String.format("%02d:%02d", time.getHour(), time.getMinute());
  }

  private Map<String, Boolean> readJson(String value) {
    if (value == null || value.isBlank()) {
      return Map.of();
    }
    try {
      return objectMapper.readValue(value, new TypeReference<LinkedHashMap<String, Boolean>>() {});
    } catch (JsonProcessingException error) {
      return Map.of();
    }
  }

  private String writeJson(Map<String, Boolean> value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException error) {
      return "{}";
    }
  }
}
