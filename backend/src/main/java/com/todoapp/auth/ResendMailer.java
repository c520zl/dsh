package com.todoapp.auth;

import com.todoapp.config.AppProperties;
import java.util.Map;
import org.springframework.web.client.RestClient;

public class ResendMailer implements Mailer {
  private final AppProperties properties;
  private final RestClient client = RestClient.builder().baseUrl("https://api.resend.com").build();

  public ResendMailer(AppProperties properties) {
    this.properties = properties;
  }

  @Override
  public void sendOtp(String email, String code) {
    if (properties.getMail().getResendApiKey() == null
        || properties.getMail().getResendApiKey().isBlank()) {
      throw new IllegalStateException("RESEND_API_KEY is required when MAIL_DRIVER=resend");
    }
    client
        .post()
        .uri("/emails")
        .header("Authorization", "Bearer " + properties.getMail().getResendApiKey())
        .body(
            Map.of(
                "from", properties.getMail().getFrom(),
                "to", java.util.List.of(email),
                "subject", "Todo App 登录验证码",
                "text", "你的 Todo App 验证码是 " + code + "，"
                    + Math.max(1, properties.getAuth().getOtpTtlSeconds() / 60) + " 分钟内有效。"))
        .retrieve()
        .toBodilessEntity();
  }
}
