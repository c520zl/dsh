package com.todoapp.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.mapper.IdempotencyMapper;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdempotencyService {
  private final IdempotencyMapper mapper;
  private final ObjectMapper objectMapper;

  public IdempotencyService(IdempotencyMapper mapper, ObjectMapper objectMapper) {
    this.mapper = mapper;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public Object run(String userId, String key, Supplier<Object> operation) {
    if (key == null || key.isBlank()) {
      return operation.get();
    }
    if (key.length() > 200) {
      throw ApiException.badRequest("Idempotency-Key 过长");
    }
    int inserted = mapper.insertPlaceholder(userId, key);
    if (inserted == 0) {
      String cached = mapper.selectResponseForUpdate(userId, key);
      if (cached == null || "null".equals(cached)) {
        throw ApiException.conflict("相同 Idempotency-Key 的请求仍在处理中", java.util.Map.of());
      }
      try {
        return objectMapper.readValue(cached, Object.class);
      } catch (Exception error) {
        throw new IllegalStateException("Failed to read idempotent response", error);
      }
    }
    Object result = operation.get();
    try {
      mapper.updateResponse(userId, key, objectMapper.writeValueAsString(result));
    } catch (Exception error) {
      throw new IllegalStateException("Failed to store idempotent response", error);
    }
    return result;
  }
}
