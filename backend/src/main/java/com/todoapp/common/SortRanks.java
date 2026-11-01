package com.todoapp.common;

import java.security.SecureRandom;

public final class SortRanks {
  private static final SecureRandom RANDOM = new SecureRandom();

  private SortRanks() {}

  /** New tasks belong at the top of an ascending manual order. */
  public static String newTaskSortRank() {
    long inverted = 9_999_999_999_999L - System.currentTimeMillis();
    return "z" + pad(Long.toString(inverted, 36), 10) + hex(2);
  }

  /** New lists keep creation order by default. */
  public static String newListSortRank() {
    return "a" + pad(Long.toString(System.currentTimeMillis(), 36), 10) + hex(2);
  }

  public static boolean isSortRank(String value) {
    return value != null && !value.isBlank() && value.length() <= 128;
  }

  private static String pad(String value, int width) {
    return "0".repeat(Math.max(0, width - value.length())) + value;
  }

  private static String hex(int bytes) {
    byte[] random = new byte[bytes];
    RANDOM.nextBytes(random);
    StringBuilder builder = new StringBuilder(bytes * 2);
    for (byte value : random) {
      builder.append(String.format("%02x", value));
    }
    return builder.toString();
  }
}
