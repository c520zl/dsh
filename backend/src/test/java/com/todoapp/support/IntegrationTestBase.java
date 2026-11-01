package com.todoapp.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Assertions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestSupport.class)
public abstract class IntegrationTestBase {
  @Autowired protected MockMvc mockMvc;
  @Autowired protected ObjectMapper objectMapper;
  @Autowired protected FakeMailer mailer;

  public record Session(
      String email, String userId, String deviceId, String accessToken, String refreshToken, String inboxId) {}

  protected JsonNode post(String path, Object body, String token) throws Exception {
    return request(MockMvcRequestBuilders.post(path), body, token, 200);
  }

  protected JsonNode patch(String path, Object body, String token) throws Exception {
    return request(MockMvcRequestBuilders.patch(path), body, token, 200);
  }

  protected JsonNode get(String path, String token) throws Exception {
    return request(MockMvcRequestBuilders.get(path), null, token, 200);
  }

  protected JsonNode request(
      MockHttpServletRequestBuilder builder, Object body, String token, int expectedStatus)
      throws Exception {
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    if (body != null) {
      builder.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsBytes(body));
    }
    MvcResult result = mockMvc.perform(builder).andReturn();
    Assertions.assertEquals(
        expectedStatus,
        result.getResponse().getStatus(),
        () -> "Unexpected response: " + new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
    String content = new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    return content.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(content);
  }

  protected int status(MockHttpServletRequestBuilder builder, Object body, String token) throws Exception {
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    if (body != null) {
      builder.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsBytes(body));
    }
    return mockMvc.perform(builder).andReturn().getResponse().getStatus();
  }

  protected Session registerUser() throws Exception {
    return registerUser("UTC");
  }

  protected Session registerUser(String timezone) throws Exception {
    String email = "user-" + UUID.randomUUID() + "@example.com";
    JsonNode requested =
        request(
            MockMvcRequestBuilders.post("/v1/auth/otp/request"), Map.of("email", email), null, 202);
    Assertions.assertEquals("验证码已发送", requested.path("message").asText());
    JsonNode verified =
        post(
            "/v1/auth/otp/verify",
            Map.of(
                "email", email,
                "code", mailer.codeFor(email),
                "device", Map.of("name", "Test iPhone", "platform", "ios", "appVersion", "0.1.0", "osVersion", "18.0")),
            null);
    String accessToken = verified.path("accessToken").asText();
    if (!"UTC".equals(timezone)) {
      patch("/v1/me", Map.of("timezone", timezone), accessToken);
    }
    JsonNode lists = get("/v1/lists", accessToken);
    String inboxId = null;
    for (JsonNode list : lists) {
      if (list.path("isDefault").asBoolean()) {
        inboxId = list.path("id").asText();
      }
    }
    return new Session(
        email,
        verified.path("user").path("id").asText(),
        verified.path("deviceId").asText(),
        accessToken,
        verified.path("refreshToken").asText(),
        inboxId);
  }

  protected JsonNode createTask(Session session, Map<String, Object> body) throws Exception {
    return request(MockMvcRequestBuilders.post("/v1/tasks"), body, session.accessToken(), 201);
  }

  protected static String uuid() {
    return UUID.randomUUID().toString();
  }

  protected static Map<String, Object> map(Object... pairs) {
    Map<String, Object> map = new java.util.LinkedHashMap<>();
    for (int i = 0; i + 1 < pairs.length; i += 2) {
      map.put(String.valueOf(pairs[i]), pairs[i + 1]);
    }
    return map;
  }

  protected static List<Object> list(Object... values) {
    return List.of(values);
  }
}
