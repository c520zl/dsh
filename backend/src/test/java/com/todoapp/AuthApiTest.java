package com.todoapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.todoapp.support.IntegrationTestBase;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AuthApiTest extends IntegrationTestBase {
  @Test
  void otpLoginCreatesUserInboxAndSettings() throws Exception {
    Session user = registerUser();
    JsonNode me = get("/v1/me", user.accessToken());
    assertEquals(user.email(), me.path("user").path("email").asText());
    assertEquals("09:00", me.path("settings").path("defaultReminderTime").asText());
    JsonNode lists = get("/v1/lists", user.accessToken());
    assertEquals(1, lists.size());
    assertTrue(lists.get(0).path("isDefault").asBoolean());
    assertEquals("收件箱", lists.get(0).path("name").asText());
  }

  @Test
  void otpResendCooldownIsEnforced() throws Exception {
    String email = "cooldown-" + uuid() + "@example.com";
    request(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/otp/request"),
        Map.of("email", email), null, 202);
    JsonNode second = request(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/otp/request"),
        Map.of("email", email), null, 429);
    assertEquals("RATE_LIMITED", second.path("error").path("code").asText());
  }

  @Test
  void refreshRotationAndReplayRevokeFamily() throws Exception {
    Session user = registerUser();
    JsonNode refreshed = post("/v1/auth/refresh", Map.of("refreshToken", user.refreshToken()), null);
    String newRefresh = refreshed.path("refreshToken").asText();
    assertNotEquals(user.refreshToken(), newRefresh);
    assertEquals(401, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/refresh"),
        Map.of("refreshToken", user.refreshToken()), null));
    assertEquals(401, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/refresh"),
        Map.of("refreshToken", newRefresh), null));
    assertEquals(401, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/me"),
        null, refreshed.path("accessToken").asText()));
  }

  @Test
  void logoutAndDeviceRevocationInvalidateAccessTokens() throws Exception {
    Session user = registerUser();
    assertEquals(204, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/logout"),
        Map.of(), user.accessToken()));
    assertEquals(401, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/me"),
        null, user.accessToken()));
  }

  @Test
  void updateMeAndValidateTimezone() throws Exception {
    Session user = registerUser();
    assertEquals(400, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/v1/me"),
        Map.of("timezone", "Mars/Olympus"), user.accessToken()));
    JsonNode updated = patch(
        "/v1/me",
        Map.of(
            "displayName", "牛奶爱好者",
            "timezone", "Asia/Shanghai",
            "settings", Map.of(
                "theme", "dark",
                "defaultReminderTime", "08:30",
                "quietHours", Map.of("start", "22:00", "end", "07:00"))),
        user.accessToken());
    assertEquals("牛奶爱好者", updated.path("user").path("displayName").asText());
    assertEquals("Asia/Shanghai", updated.path("user").path("timezone").asText());
    assertEquals("dark", updated.path("settings").path("theme").asText());
    assertEquals("08:30", updated.path("settings").path("defaultReminderTime").asText());
  }

  @Test
  void oauthLoginIsIdempotent() throws Exception {
    JsonNode first = post(
        "/v1/auth/oauth/google",
        Map.of("identityToken", "google-token-abcdefghijklmnop", "device", Map.of("name", "Pixel", "platform", "android")),
        null);
    JsonNode second = post(
        "/v1/auth/oauth/google",
        Map.of("identityToken", "google-token-abcdefghijklmnop", "device", Map.of("name", "Pixel", "platform", "android")),
        null);
    assertEquals(
        first.path("user").path("id").asText(), second.path("user").path("id").asText());
  }

  @Test
  void unauthenticatedRequestsUseUnifiedErrorShape() throws Exception {
    JsonNode response = request(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/me"), null, null, 401);
    assertEquals("UNAUTHENTICATED", response.path("error").path("code").asText());
    assertTrue(response.path("error").path("requestId").asText().startsWith("req_"));
  }

  @Test
  void accountDeletionSchedulesCleanupAndBlocksLogin() throws Exception {
    Session user = registerUser();
    JsonNode deleted = request(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/v1/me"),
        null, user.accessToken(), 202);
    assertEquals("deletion_scheduled", deleted.path("status").asText());
    assertEquals(401, status(
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/me"),
        null, user.accessToken()));
  }
}
