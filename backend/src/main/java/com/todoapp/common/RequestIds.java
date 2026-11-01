package com.todoapp.common;

import jakarta.servlet.http.HttpServletRequest;

public final class RequestIds {
  public static final String ATTRIBUTE = "todo.requestId";

  private RequestIds() {}

  public static String get(HttpServletRequest request) {
    Object value = request.getAttribute(ATTRIBUTE);
    return value instanceof String id ? id : "unknown";
  }
}
