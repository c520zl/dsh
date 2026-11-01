package com.todoapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.todoapp.common.ApiException;
import com.todoapp.common.Recurrence;
import com.todoapp.common.TimeUtils;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

class DomainTest {
  @Test
  void weeklyOccurrenceUsesTaskTimezone() {
    Recurrence.ParsedRule rule = Recurrence.parse("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO");
    Recurrence.Occurrence next = Recurrence.next(new Recurrence.Input(
        rule,
        ZoneId.of("Asia/Shanghai"),
        Instant.parse("2026-11-02T01:00:00Z"),
        null,
        Instant.parse("2026-11-02T01:00:00Z")));
    assertEquals("2026-11-09T01:00:00Z", next.dueAt().toString());
    assertEquals(LocalDate.parse("2026-11-09"), next.localDate());
  }

  @Test
  void monthlyClampsDay31() {
    Recurrence.ParsedRule rule = Recurrence.parse("FREQ=MONTHLY");
    Recurrence.Occurrence next = Recurrence.next(new Recurrence.Input(
        rule,
        ZoneId.of("UTC"),
        Instant.parse("2026-01-31T09:00:00Z"),
        null,
        Instant.parse("2026-01-31T09:00:00Z")));
    assertEquals("2026-02-28T09:00:00Z", next.dueAt().toString());
  }

  @Test
  void springForwardGapMovesToNextValidWallTime() {
    Instant result = TimeUtils.zonedWallTimeToInstant(
        ZoneId.of("America/New_York"), LocalDate.parse("2026-03-08"), 2, 30);
    assertEquals("2026-03-08T07:00:00Z", result.toString());
  }

  @Test
  void fallBackOverlapTakesEarlierInstant() {
    Instant result = TimeUtils.zonedWallTimeToInstant(
        ZoneId.of("America/New_York"), LocalDate.parse("2026-11-01"), 1, 30);
    assertEquals("2026-11-01T05:30:00Z", result.toString());
  }

  @Test
  void invalidRulesAreRejected() {
    assertThrows(ApiException.class, () -> Recurrence.parse("FREQ=DAILY;COUNT=3"));
    assertThrows(ApiException.class, () -> Recurrence.parse("FREQ=HOURLY"));
  }
}
