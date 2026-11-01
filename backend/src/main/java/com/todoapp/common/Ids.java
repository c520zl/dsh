package com.todoapp.common;

import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.UUID;

/** RFC 9562 UUIDv7. */
public final class Ids {
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final java.util.regex.Pattern UUID_RE =
      java.util.regex.Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

  private Ids() {}

  public static String uuidv7() {
    byte[] bytes = new byte[16];
    RANDOM.nextBytes(bytes);
    long timestamp = System.currentTimeMillis();
    bytes[0] = (byte) (timestamp >>> 40);
    bytes[1] = (byte) (timestamp >>> 32);
    bytes[2] = (byte) (timestamp >>> 24);
    bytes[3] = (byte) (timestamp >>> 16);
    bytes[4] = (byte) (timestamp >>> 8);
    bytes[5] = (byte) timestamp;
    bytes[6] = (byte) ((bytes[6] & 0x0f) | 0x70);
    bytes[8] = (byte) ((bytes[8] & 0x3f) | 0x80);
    ByteBuffer buffer = ByteBuffer.wrap(bytes);
    return new UUID(buffer.getLong(), buffer.getLong()).toString();
  }

  public static boolean isUuid(String value) {
    return value != null && UUID_RE.matcher(value).matches();
  }

  public static String requireUuid(String value, String field) {
    if (!isUuid(value)) {
      throw ApiException.badRequest("无效的 " + field, java.util.Map.of(field, String.valueOf(value)));
    }
    return value;
  }
}
