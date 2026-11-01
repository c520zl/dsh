package com.todoapp.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<ErrorResponse> handleApi(ApiException error, HttpServletRequest request) {
    HttpHeaders headers = new HttpHeaders();
    error.getHeaders().forEach(headers::set);
    return ResponseEntity.status(error.getStatus())
        .headers(headers)
        .body(
            ErrorResponse.of(
                error.getCode(),
                error.getMessage(),
                error.getDetails().isEmpty() ? null : error.getDetails(),
                RequestIds.get(request)));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ErrorResponse> handleValidation(
      MethodArgumentNotValidException error, HttpServletRequest request) {
    List<Map<String, Object>> issues =
        error.getBindingResult().getAllErrors().stream()
            .map(
                item -> {
                  Map<String, Object> issue = new LinkedHashMap<>();
                  issue.put("path", item instanceof FieldError field ? field.getField() : item.getObjectName());
                  issue.put("message", item.getDefaultMessage());
                  return issue;
                })
            .toList();
    return badRequest(request, issues);
  }

  @ExceptionHandler(HandlerMethodValidationException.class)
  public ResponseEntity<ErrorResponse> handleMethodValidation(
      HandlerMethodValidationException error, HttpServletRequest request) {
    List<Map<String, Object>> issues =
        error.getAllValidationResults().stream()
            .flatMap(
                result ->
                    result.getResolvableErrors().stream()
                        .map(
                            item ->
                                Map.<String, Object>of(
                                    "path", String.valueOf(result.getMethodParameter().getParameterName()),
                                    "message", String.valueOf(item.getDefaultMessage()))))
            .toList();
    return badRequest(request, issues);
  }

  @ExceptionHandler({
    ConstraintViolationException.class,
    MissingServletRequestParameterException.class,
    MethodArgumentTypeMismatchException.class
  })
  public ResponseEntity<ErrorResponse> handleSimpleValidation(
      Exception error, HttpServletRequest request) {
    return badRequest(request, List.of(Map.of("message", String.valueOf(error.getMessage()))));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ErrorResponse> handleUnreadable(
      HttpMessageNotReadableException error, HttpServletRequest request) {
    return badRequest(request, List.of(Map.of("message", "请求体格式错误或包含未知字段")));
  }

  @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
  public ResponseEntity<ErrorResponse> handleNotFound(Exception error, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(
            ErrorResponse.of(
                ErrorCode.NOT_FOUND, "资源不存在", null, RequestIds.get(request)));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorResponse> handleUnknown(Exception error, HttpServletRequest request) {
    log.error("Unhandled request error requestId={}", RequestIds.get(request), error);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(
            ErrorResponse.of(
                ErrorCode.INTERNAL, "服务端错误", null, RequestIds.get(request)));
  }

  private ResponseEntity<ErrorResponse> badRequest(
      HttpServletRequest request, List<Map<String, Object>> issues) {
    return ResponseEntity.badRequest()
        .body(
            ErrorResponse.of(
                ErrorCode.VALIDATION_ERROR,
                "参数校验失败",
                Map.of("issues", issues),
                RequestIds.get(request)));
  }
}
