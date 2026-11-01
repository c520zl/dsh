package com.todoapp.config;

import com.todoapp.auth.LogMailer;
import com.todoapp.auth.Mailer;
import com.todoapp.auth.OAuthVerifier;
import com.todoapp.auth.RemoteOAuthVerifier;
import com.todoapp.auth.ResendMailer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MessagingConfig {
  @Bean
  Mailer mailer(AppProperties properties) {
    if ("resend".equalsIgnoreCase(properties.getMail().getDriver())) {
      return new ResendMailer(properties);
    }
    return new LogMailer();
  }

  @Bean
  OAuthVerifier oauthVerifier(AppProperties properties) {
    return new RemoteOAuthVerifier(properties);
  }
}
