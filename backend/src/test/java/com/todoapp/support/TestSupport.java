package com.todoapp.support;

import com.todoapp.auth.OAuthProfile;
import com.todoapp.auth.OAuthVerifier;
import java.util.Locale;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

@TestConfiguration(proxyBeanMethods = false)
public class TestSupport {
  @Bean
  @Primary
  FakeMailer fakeMailer() {
    return new FakeMailer();
  }

  @Bean
  @Primary
  OAuthVerifier fakeOAuthVerifier() {
    return (provider, token) -> {
      String clean = token.replaceAll("[^a-zA-Z0-9]", "");
      return new OAuthProfile(
          provider,
          "subject-" + clean,
          clean.toLowerCase(Locale.ROOT) + "@oauth.test",
          true,
          null);
    };
  }

  @Bean
  FlywayMigrationStrategy cleanMigrate() {
    return flyway -> {
      flyway.clean();
      flyway.migrate();
    };
  }
}
