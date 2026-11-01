package com.todoapp.common;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Single-instance fixed-window limiter; acceptable for the MVP deployment. */
public class RateLimitService {
  private record Window(long windowIndex, int count) {}

  private final Map<String, Window> windows = new ConcurrentHashMap<>();

  public boolean allow(String bucket, String identity, int limit, Instant now) {
    long windowIndex = now.getEpochSecond() / 60;
    String key = bucket + ":" + identity;
    Window updated =
        windows.compute(
            key,
            (ignored, current) -> {
              if (current == null || current.windowIndex() != windowIndex) {
                return new Window(windowIndex, 1);
              }
              return new Window(windowIndex, current.count() + 1);
            });
    return updated.count() <= limit;
  }

  public long retryAfterSeconds(Instant now) {
    return 60 - (now.getEpochSecond() % 60);
  }

  public void cleanup(Instant now) {
    long current = now.getEpochSecond() / 60;
    windows.entrySet().removeIf(entry -> current - entry.getValue().windowIndex() > 2);
  }
}
