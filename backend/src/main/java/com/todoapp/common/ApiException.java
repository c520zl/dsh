package com.todoapp.common;

import java.util.Map;

public class ApiException extends RuntimeException {
  private final int status;
  private final ErrorCode code;
  private final Map<String, Object> details;
  private final Map<String, String> headers;

  public ApiException(int status, ErrorCode code, String message) {
    this(status, code, message, Map.of(), Map.of());
  }

  public ApiException(
      int status,
      ErrorCode code,
      String message,
      Map<String, Object> details,
      Map<String, String> headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details == null ? Map.of() : details;
    this.headers = headers == null ? Map.of() : headers;
  }

  public int getStatus() {
    return status;
  }

  public ErrorCode getCode() {
    return code;
  }

  public Map<String, Object> getDetails() {
    return details;
  }

  public Map<String, String> getHeaders() {
    return headers;
  }

  public static ApiException badRequest(String message) {
    return new ApiException(400, ErrorCode.VALIDATION_ERROR, message);
  }

  public static ApiException badRequest(String message, Map<String, Object> details) {
    return new ApiException(400, ErrorCode.VALIDATION_ERROR, message, details, Map.of());
  }

  public static ApiException unauthorized(String message) {
    return new ApiException(401, ErrorCode.UNAUTHENTICATED, message);
  }

  public static ApiException forbidden(String message) {
    return new ApiException(403, ErrorCode.FORBIDDEN, message);
  }

  public static ApiException notFound(String message) {
    return new ApiException(404, ErrorCode.NOT_FOUND, message);
  }

  public static ApiException conflict(String message, Map<String, Object> details) {
    return new ApiException(409, ErrorCode.VERSION_CONFLICT, message, details, Map.of());
  }

  public static ApiException preconditionFailed(String message, Map<String, Object> details) {
    return new ApiException(412, ErrorCode.VERSION_CONFLICT, message, details, Map.of());
  }

  public static ApiException deleted(String message) {
    return new ApiException(409, ErrorCode.DELETED, message);
  }

  public static ApiException rebuildRequired(String message) {
    return new ApiException(409, ErrorCode.REBUILD_REQUIRED, message);
  }

  public static ApiException cursorExpired(Map<String, Object> details) {
    return new ApiException(410, ErrorCode.CURSOR_EXPIRED, "同步游标已过期，请全量重建", details, Map.of());
  }

  public static ApiException rateLimited(String message, long retryAfterSeconds) {
    return new ApiException(
        429,
        ErrorCode.RATE_LIMITED,
        message,
        Map.of("retryAfter", retryAfterSeconds),
        Map.of("Retry-After", String.valueOf(retryAfterSeconds)));
  }
}
