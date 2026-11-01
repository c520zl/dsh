package com.todoapp.common;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/** RRULE subset: FREQ, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, WKST. */
public final class Recurrence {
  public enum Frequency { DAILY, WEEKLY, MONTHLY, YEARLY }

  public record ParsedRule(
      Frequency frequency,
      int interval,
      List<Integer> byDay,
      List<Integer> byMonthDay,
      List<Integer> byMonth,
      String weekStart,
      String canonical) {}

  public record Occurrence(String dueDate, Instant dueAt, LocalDate localDate) {}

  public record Input(
      ParsedRule rule,
      ZoneId timezone,
      Instant dtstart,
      String dueDate,
      Instant dueAt) {}

  private static final Map<String, Integer> WEEKDAYS =
      Map.of("MO", 1, "TU", 2, "WE", 3, "TH", 4, "FR", 5, "SA", 6, "SU", 7);
  private static final Set<String> ALLOWED_PARTS =
      Set.of("FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST");

  private Recurrence() {}

  public static ParsedRule parse(String raw) {
    String source = raw == null ? "" : raw.trim().replaceFirst("(?i)^RRULE:", "");
    if (source.isBlank()) {
      throw ApiException.badRequest("recurrence.rule 不能为空");
    }
    if (source.length() > 512) {
      throw ApiException.badRequest("recurrence.rule 不能超过 512 个字符");
    }
    Map<String, String> parts = new LinkedHashMap<>();
    for (String chunk : source.split(";")) {
      if (chunk.isBlank()) {
        continue;
      }
      int eq = chunk.indexOf('=');
      if (eq <= 0 || eq == chunk.length() - 1) {
        throw ApiException.badRequest("无效的 RRULE 片段: " + chunk);
      }
      String key = chunk.substring(0, eq).trim().toUpperCase(Locale.ROOT);
      String value = chunk.substring(eq + 1).trim().toUpperCase(Locale.ROOT);
      if (!ALLOWED_PARTS.contains(key)) {
        if (key.equals("COUNT") || key.equals("UNTIL")) {
          throw ApiException.badRequest("COUNT/UNTIL 请使用 recurrence.countRemaining / until 字段");
        }
        throw ApiException.badRequest("不支持的 RRULE 字段: " + key);
      }
      if (parts.putIfAbsent(key, value) != null) {
        throw ApiException.badRequest("重复的 RRULE 字段: " + key);
      }
    }

    Frequency frequency;
    try {
      frequency = Frequency.valueOf(parts.getOrDefault("FREQ", ""));
    } catch (IllegalArgumentException error) {
      throw ApiException.badRequest("FREQ 必须是 DAILY/WEEKLY/MONTHLY/YEARLY");
    }
    int interval = parts.containsKey("INTERVAL") ? parseInt(parts.get("INTERVAL"), "INTERVAL") : 1;
    if (interval < 1 || interval > 999) {
      throw ApiException.badRequest("INTERVAL 必须在 1 到 999 之间");
    }
    List<Integer> byDay = parseByDay(parts.get("BYDAY"), frequency);
    List<Integer> byMonthDay = parseIntegerList(parts.get("BYMONTHDAY"), 1, 31, true, "BYMONTHDAY");
    List<Integer> byMonth = parseIntegerList(parts.get("BYMONTH"), 1, 12, false, "BYMONTH");
    String weekStart = parts.getOrDefault("WKST", "MO");
    if (!weekStart.equals("MO") && !weekStart.equals("SU")) {
      throw ApiException.badRequest("WKST 必须是 MO 或 SU");
    }
    if (frequency == Frequency.MONTHLY && !byDay.isEmpty()) {
      throw ApiException.badRequest("MONTHLY 不支持 BYDAY");
    }
    if (frequency == Frequency.YEARLY && !byDay.isEmpty()) {
      throw ApiException.badRequest("YEARLY 不支持 BYDAY");
    }
    if (frequency == Frequency.WEEKLY && !byMonthDay.isEmpty()) {
      throw ApiException.badRequest("WEEKLY 不支持 BYMONTHDAY");
    }

    List<String> canonical = new ArrayList<>();
    canonical.add("FREQ=" + frequency);
    if (interval != 1) {
      canonical.add("INTERVAL=" + interval);
    }
    if (!byDay.isEmpty()) {
      canonical.add(
          "BYDAY="
              + byDay.stream()
                  .sorted()
                  .map(
                      day ->
                          WEEKDAYS.entrySet().stream()
                              .filter(entry -> entry.getValue().equals(day))
                              .findFirst()
                              .map(Map.Entry::getKey)
                              .orElseThrow())
                  .reduce((left, right) -> left + "," + right)
                  .orElse(""));
    }
    if (!byMonthDay.isEmpty()) {
      canonical.add("BYMONTHDAY=" + join(byMonthDay));
    }
    if (!byMonth.isEmpty()) {
      canonical.add("BYMONTH=" + join(byMonth));
    }
    if (!weekStart.equals("MO")) {
      canonical.add("WKST=" + weekStart);
    }
    return new ParsedRule(
        frequency,
        interval,
        List.copyOf(byDay),
        List.copyOf(byMonthDay),
        List.copyOf(byMonth),
        weekStart,
        String.join(";", canonical));
  }

  public static Occurrence next(Input input) {
    boolean timed = input.dueAt() != null;
    LocalDate currentDate =
        timed
            ? TimeUtils.localDateOf(input.dueAt(), input.timezone())
            : LocalDate.parse(input.dueDate());
    LocalDate anchorDate = TimeUtils.localDateOf(input.dtstart(), input.timezone());
    LocalTime wallTime =
        timed ? input.dueAt().atZone(input.timezone()).toLocalTime() : null;

    LocalDate nextDate = findNextDate(input.rule(), currentDate, anchorDate);
    if (timed) {
      return new Occurrence(
          null,
          TimeUtils.zonedWallTimeToInstant(
              input.timezone(), nextDate, wallTime.getHour(), wallTime.getMinute()),
          nextDate);
    }
    return new Occurrence(nextDate.toString(), null, nextDate);
  }

  private static LocalDate findNextDate(ParsedRule rule, LocalDate current, LocalDate anchor) {
    return switch (rule.frequency()) {
      case DAILY -> findNextDaily(rule, current);
      case WEEKLY -> findNextWeekly(rule, current, anchor);
      case MONTHLY -> findNextMonthly(rule, current, anchor);
      case YEARLY -> findNextYearly(rule, current, anchor);
    };
  }

  private static LocalDate findNextDaily(ParsedRule rule, LocalDate current) {
    LocalDate candidate = current.plusDays(rule.interval());
    for (int i = 0; i < 3000; i += 1) {
      if (matchesFilters(rule, candidate)) {
        return candidate;
      }
      candidate = candidate.plusDays(rule.interval());
    }
    throw ApiException.badRequest("无法计算下一次重复实例");
  }

  private static LocalDate findNextWeekly(ParsedRule rule, LocalDate current, LocalDate anchor) {
    int startIso = rule.weekStart().equals("SU") ? 7 : 1;
    List<Integer> allowedDays =
        rule.byDay().isEmpty() ? List.of(anchor.getDayOfWeek().getValue()) : rule.byDay();
    LocalDate currentWeekStart = weekStartOf(current, startIso);
    for (int weekIndex = 0; weekIndex < 1060; weekIndex += 1) {
      LocalDate week = currentWeekStart.plusWeeks((long) weekIndex * rule.interval());
      for (int offset = 0; offset < 7; offset += 1) {
        LocalDate candidate = week.plusDays(offset);
        if (!candidate.isAfter(current)) {
          continue;
        }
        if (!allowedDays.contains(candidate.getDayOfWeek().getValue())) {
          continue;
        }
        if (!rule.byMonth().isEmpty() && !rule.byMonth().contains(candidate.getMonthValue())) {
          continue;
        }
        return candidate;
      }
    }
    throw ApiException.badRequest("无法计算下一次重复实例");
  }

  private static LocalDate findNextMonthly(ParsedRule rule, LocalDate current, LocalDate anchor) {
    LocalDate monthStart = current.withDayOfMonth(1);
    for (int monthIndex = 0; monthIndex < 1200; monthIndex += 1) {
      LocalDate month = monthStart.plusMonths((long) monthIndex * rule.interval());
      if (!rule.byMonth().isEmpty() && !rule.byMonth().contains(month.getMonthValue())) {
        continue;
      }
      for (int day : resolveDaysOfMonth(rule, month, anchor.getDayOfMonth())) {
        LocalDate candidate = month.withDayOfMonth(day);
        if (candidate.isAfter(current)) {
          return candidate;
        }
      }
    }
    throw ApiException.badRequest("无法计算下一次重复实例");
  }

  private static LocalDate findNextYearly(ParsedRule rule, LocalDate current, LocalDate anchor) {
    for (int yearIndex = 0; yearIndex < 500; yearIndex += 1) {
      int year = current.getYear() + yearIndex * rule.interval();
      List<Integer> months =
          rule.byMonth().isEmpty() ? List.of(anchor.getMonthValue()) : rule.byMonth();
      for (int month : months) {
        int maxDay = LocalDate.of(year, month, 1).lengthOfMonth();
        List<Integer> days =
            rule.byMonthDay().isEmpty()
                ? List.of(Math.min(anchor.getDayOfMonth(), maxDay))
                : rule.byMonthDay().stream()
                    .map(value -> value < 0 ? maxDay + value + 1 : Math.min(value, maxDay))
                    .toList();
        for (int day : new TreeSet<>(days)) {
          LocalDate candidate = LocalDate.of(year, month, Math.max(1, Math.min(day, maxDay)));
          if (candidate.isAfter(current)) {
            return candidate;
          }
        }
      }
    }
    throw ApiException.badRequest("无法计算下一次重复实例");
  }

  private static List<Integer> resolveDaysOfMonth(ParsedRule rule, LocalDate month, int anchorDay) {
    int maxDay = month.lengthOfMonth();
    List<Integer> days =
        rule.byMonthDay().isEmpty()
            ? List.of(Math.min(anchorDay, maxDay))
            : rule.byMonthDay().stream()
                .map(value -> value < 0 ? maxDay + value + 1 : Math.min(value, maxDay))
                .toList();
    return new ArrayList<>(new TreeSet<>(days));
  }

  private static boolean matchesFilters(ParsedRule rule, LocalDate candidate) {
    if (!rule.byDay().isEmpty() && !rule.byDay().contains(candidate.getDayOfWeek().getValue())) {
      return false;
    }
    if (!rule.byMonth().isEmpty() && !rule.byMonth().contains(candidate.getMonthValue())) {
      return false;
    }
    if (!rule.byMonthDay().isEmpty()) {
      int maxDay = candidate.lengthOfMonth();
      List<Integer> days =
          rule.byMonthDay().stream()
              .map(value -> value < 0 ? maxDay + value + 1 : Math.min(value, maxDay))
              .toList();
      if (!days.contains(candidate.getDayOfMonth())) {
        return false;
      }
    }
    return true;
  }

  private static LocalDate weekStartOf(LocalDate date, int startIso) {
    int diff = (date.getDayOfWeek().getValue() - startIso + 7) % 7;
    return date.minusDays(diff);
  }

  private static List<Integer> parseByDay(String value, Frequency frequency) {
    if (value == null || value.isBlank()) {
      return List.of();
    }
    if (frequency != Frequency.DAILY && frequency != Frequency.WEEKLY) {
      throw ApiException.badRequest("BYDAY 只支持 DAILY/WEEKLY");
    }
    Set<Integer> result = new LinkedHashSet<>();
    for (String token : value.split(",")) {
      Integer day = WEEKDAYS.get(token.trim());
      if (day == null) {
        throw ApiException.badRequest("无效的 BYDAY 值: " + token);
      }
      result.add(day);
    }
    return new ArrayList<>(new TreeSet<>(result));
  }

  private static List<Integer> parseIntegerList(
      String value, int minAbs, int maxAbs, boolean allowNegative, String field) {
    if (value == null || value.isBlank()) {
      return List.of();
    }
    Set<Integer> result = new LinkedHashSet<>();
    for (String token : value.split(",")) {
      String trimmed = token.trim();
      int parsed;
      try {
        parsed = Integer.parseInt(trimmed);
      } catch (NumberFormatException error) {
        throw ApiException.badRequest("无效的 " + field + " 值: " + token);
      }
      int abs = Math.abs(parsed);
      if (parsed == 0 || abs < minAbs || abs > maxAbs || (!allowNegative && parsed < 0)) {
        throw ApiException.badRequest("无效的 " + field + " 值: " + token);
      }
      result.add(parsed);
    }
    return new ArrayList<>(new TreeSet<>(result));
  }

  private static int parseInt(String value, String field) {
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException error) {
      throw ApiException.badRequest(field + " 必须是整数");
    }
  }

  private static String join(List<Integer> values) {
    return values.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse("");
  }

  public static DayOfWeek dayOfWeek(int value) {
    return DayOfWeek.of(value);
  }
}
