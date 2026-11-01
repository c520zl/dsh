package com.todoapp.auth;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import com.todoapp.common.ApiException;
import com.todoapp.config.AppProperties;
import java.net.URL;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class RemoteOAuthVerifier implements OAuthVerifier {
  private final AppProperties properties;
  private final Map<String, ConfigurableJWTProcessor<SecurityContext>> processors =
      new ConcurrentHashMap<>();

  public RemoteOAuthVerifier(AppProperties properties) {
    this.properties = properties;
  }

  @Override
  public OAuthProfile verify(String provider, String identityToken) {
    if ("google".equals(provider)) {
      return verifyGoogle(identityToken);
    }
    if ("apple".equals(provider)) {
      return verifyApple(identityToken);
    }
    throw ApiException.unauthorized("不支持的登录方式");
  }

  private OAuthProfile verifyGoogle(String token) {
    if (properties.getAuth().getGoogleClientId() == null
        || properties.getAuth().getGoogleClientId().isBlank()) {
      throw ApiException.unauthorized("Google 登录未配置");
    }
    JWTClaimsSet claims =
        process(
            "google",
            token,
            "https://www.googleapis.com/oauth2/v3/certs",
            "https://accounts.google.com",
            properties.getAuth().getGoogleClientId());
    if (claims == null) {
      claims =
          process(
              "google-compat",
              token,
              "https://www.googleapis.com/oauth2/v3/certs",
              "accounts.google.com",
              properties.getAuth().getGoogleClientId());
    }
    if (claims == null) {
      throw ApiException.unauthorized("Google identityToken 无效");
    }
    return new OAuthProfile(
        "google",
        claims.getSubject(),
        stringClaim(claims, "email"),
        booleanClaim(claims, "email_verified"),
        stringClaim(claims, "name"));
  }

  private OAuthProfile verifyApple(String token) {
    if (properties.getAuth().getAppleClientId() == null
        || properties.getAuth().getAppleClientId().isBlank()) {
      throw ApiException.unauthorized("Apple 登录未配置");
    }
    JWTClaimsSet claims =
        process(
            "apple",
            token,
            "https://appleid.apple.com/auth/keys",
            "https://appleid.apple.com",
            properties.getAuth().getAppleClientId());
    if (claims == null) {
      throw ApiException.unauthorized("Apple identityToken 无效");
    }
    return new OAuthProfile(
        "apple",
        claims.getSubject(),
        stringClaim(claims, "email"),
        booleanClaim(claims, "email_verified"),
        null);
  }

  private JWTClaimsSet process(
      String name, String token, String jwksUrl, String issuer, String audience) {
    try {
      ConfigurableJWTProcessor<SecurityContext> processor =
          processors.computeIfAbsent(
              name,
              key -> {
                try {
                  JWKSource<SecurityContext> source = new RemoteJWKSet<>(new URL(jwksUrl));
                  ConfigurableJWTProcessor<SecurityContext> created = new DefaultJWTProcessor<>();
                  created.setJWSKeySelector(
                      new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, source));
                  return created;
                } catch (Exception error) {
                  throw new IllegalStateException("Failed to initialize OAuth JWKS", error);
                }
              });
      JWTClaimsSet claims = processor.process(token, null);
      if (!issuer.equals(claims.getIssuer())
          || claims.getAudience() == null
          || !claims.getAudience().contains(audience)
          || claims.getSubject() == null
          || claims.getExpirationTime() == null
          || claims.getExpirationTime().toInstant().isBefore(Instant.now())) {
        return null;
      }
      return claims;
    } catch (Exception error) {
      return null;
    }
  }

  private static String stringClaim(JWTClaimsSet claims, String name) {
    Object value = claims.getClaim(name);
    return value instanceof String text ? text : null;
  }

  private static Boolean booleanClaim(JWTClaimsSet claims, String name) {
    Object value = claims.getClaim(name);
    if (value instanceof Boolean bool) {
      return bool;
    }
    if (value instanceof String text) {
      return Boolean.parseBoolean(text);
    }
    return null;
  }
}
