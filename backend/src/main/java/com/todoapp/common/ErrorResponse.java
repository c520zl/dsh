package com.todoapp.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

public record ErrorResponse(ErrorBody error) {
  public static ErrorResponse of(ErrorCode code, String message, Map<String, Object> details, String requestId) {
    return new ErrorResponse(new ErrorBody(code.name(), message, details, requestId));
  }

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record ErrorBody(
      String code, String message, Map<String, Object> details, String requestId) {}
}
