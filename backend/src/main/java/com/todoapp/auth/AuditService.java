package com.todoapp.auth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.config.AppProperties;
import com.todoapp.mapper.AuditMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
  private final AuditMapper auditMapper;
  private final AppProperties properties;
  private final ObjectMapper objectMapper;

  public AuditService(AuditMapper auditMapper, AppProperties properties, ObjectMapper objectMapper) {
    this.auditMapper = auditMapper;
    this.properties = properties;
    this.objectMapper = objectMapper;
  }

  public void record(String userId, String event, String ip, Map<String, Object> metadata) {
    AuditLog log = new AuditLog();
    log.setUserId(userId);
    log.setEvent(event.length() > 64 ? event.substring(0, 64) : event);
    log.setIpHash(ip == null ? null : hash(ip));
    log.setMetadata(writeJson(metadata));
    auditMapper.insert(log);
  }

  private String writeJson(Map<String, Object> metadata) {
    try {
      return objectMapper.writeValueAsString(metadata == null ? Map.of() : metadata);
    } catch (JsonProcessingException error) {
      return "{}";
    }
  }

  private String hash(String ip) {
    try {
      String source = properties.getAuditIpSalt() + ":" + ip;
      return HexFormat.of()
          .formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }
}
