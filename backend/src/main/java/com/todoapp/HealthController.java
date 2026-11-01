package com.todoapp;

import java.time.Instant;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  private final JdbcTemplate jdbcTemplate;

  public HealthController(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @GetMapping("/v1/health")
  public Map<String, String> health() {
    jdbcTemplate.queryForObject("SELECT 1", Integer.class);
    return Map.of("status", "ok", "database", "ok", "time", Instant.now().toString());
  }
}
