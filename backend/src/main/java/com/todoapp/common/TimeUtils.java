package com.todoapp.common;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class TimeUtils {
  public static final ZoneOffset UTC = ZoneOffset.UTC;
  public static final DateTimeFormatter ISO_INSTANT = DateTimeFormatter.ISO_INSTANT;

  private TimeUtils() {}

  public static ZoneId zone(String value) {
    try {
      return ZoneId.of(value);
    } catch (DateTimeException error) {
      throw ApiException.badRequest("无效的 IANA 时区", Map.of("timezone", String.valueOf(value)));
    }
  }

  public static LocalDateTime fromInstant(Instant instant) {
    return LocalDateTime.ofInstant(instant, UTC).truncatedTo(ChronoUnit.MILLIS);
  }

  public static Instant toInstant(LocalDateTime value) {
    return value.toInstant(UTC);
  }

  public static LocalDateTime nowUtc() {
    return LocalDateTime.now(UTC).truncatedTo(ChronoUnit.MILLIS);
  }

  public static String iso(Instant instant) {
    return ISO_INSTANT.format(instant);
  }

  public static String iso(LocalDateTime value) {
    return iso(toInstant(value));
  }

  public static Instant parseInstant(String value, String field) {
    try {
      return Instant.parse(value);
    } catch (DateTimeParseException error) {
      throw ApiException.badRequest(field + " 不是有效的 ISO 8601 UTC 时间");
    }
  }

  public static LocalDate parseDate(String value, String field) {
    try {
      return LocalDate.parse(value);
    } catch (DateTimeParseException error) {
      throw ApiException.badRequest(field + " 不是有效的日期");
    }
  }

  public static LocalDate localDateOf(Instant instant, ZoneId zone) {
    return instant.atZone(zone).toLocalDate();
  }

  public static LocalDate localDateOf(LocalDateTime utc, ZoneId zone) {
    return localDateOf(toInstant(utc), zone);
  }

  /**
   * Resolve a local wall time to UTC. Spring/gap rules match the product spec:
   * spring-forward gaps move to the next valid wall time; fall-back overlaps take
   * the earlier (first) instant.
   */
  public static Instant zonedWallTimeToInstant(ZoneId zone, LocalDate date, int hour, int minute) {
    LocalDateTime wall = LocalDateTime.of(date, LocalTime.of(hour, minute));
    List<ZoneOffset> offsets = zone.getRules().getValidOffsets(wall);
    if (offsets.size() == 1) {
      return wall.toInstant(offsets.get(0));
    }
    if (offsets.size() == 2) {
      return offsets.stream()
          .map(wall::toInstant)
          .min(Comparator.naturalOrder())
          .orElseThrow();
    }
    for (int add = 1; add <= 180; add += 1) {
      LocalDateTime shifted = wall.plusMinutes(add);
      List<ZoneOffset> shiftedOffsets = zone.getRules().getValidOffsets(shifted);
      if (!shiftedOffsets.isEmpty()) {
        return shifted.toInstant(
            shiftedOffsets.stream().min(Comparator.naturalOrder()).orElseThrow());
      }
    }
    throw ApiException.badRequest("无法解析本地时间", Map.of("date", date.toString()));
  }

  public static LocalTime parseTimeOfDay(String value) {
    try {
      return LocalTime.parse(value);
    } catch (DateTimeParseException error) {
      throw ApiException.badRequest("无效的时间格式", Map.of("time", String.valueOf(value)));
    }
  }

  public static LocalDate nextDate(LocalDate date) {
    return date.plusDays(1);
  }

  public static Instant addMinutes(Instant instant, long minutes) {
    return instant.plus(minutes, ChronoUnit.MINUTES);
  }

  public static Instant addDays(Instant instant, long days) {
    return instant.plus(days, ChronoUnit.DAYS);
  }

  public static String occurrenceKey(String dueDate, Instant dueAt) {
    if (dueDate != null) {
      return "date:" + dueDate;
    }
    if (dueAt != null) {
      return "at:" + iso(dueAt);
    }
    return null;
  }

  public static String currentOccurrenceKey(LocalDate dueDate, LocalDateTime dueAtUtc) {
    return occurrenceKey(dueDate == null ? null : dueDate.toString(), dueAtUtc == null ? null : toInstant(dueAtUtc));
  }

  public static List<String> dateRangeDates(LocalDate start, int days) {
    List<String> result = new ArrayList<>();
    for (int i = 0; i < days; i += 1) {
      result.add(start.plusDays(i).toString());
    }
    return result;
  }

  public static ZonedDateTime localNow(ZoneId zone) {
    return ZonedDateTime.now(zone);
  }
}
