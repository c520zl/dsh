package com.todoapp.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.Ed25519Signer;
import com.nimbusds.jose.crypto.Ed25519Verifier;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.OctetKeyPair;
import com.nimbusds.jose.jwk.gen.OctetKeyPairGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.todoapp.common.ApiException;
import com.todoapp.common.Ids;
import com.todoapp.config.AppProperties;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class TokenService {
  private static final Logger log = LoggerFactory.getLogger(TokenService.class);
  private static final SecureRandom RANDOM = new SecureRandom();

  private final AppProperties properties;
  private OctetKeyPair privateKey;
  private OctetKeyPair publicKey;

  public record Claims(String uid, String did, long authVersion, long deviceAuthVersion) {}

  public TokenService(AppProperties properties) {
    this.properties = properties;
  }

  @PostConstruct
  void init() {
    try {
      if (properties.getAuth().getPrivateKey() == null
          || properties.getAuth().getPrivateKey().isBlank()
          || properties.getAuth().getPublicKey() == null
          || properties.getAuth().getPublicKey().isBlank()) {
        OctetKeyPair generated = new OctetKeyPairGenerator(Curve.Ed25519).generate();
        this.privateKey = generated;
        this.publicKey = generated.toPublicJWK();
        log.warn("AUTH_JWT_PRIVATE_KEY/AUTH_JWT_PUBLIC_KEY not set; using ephemeral Ed25519 keys");
      } else {
        this.privateKey = asOctetKey(properties.getAuth().getPrivateKey());
        this.publicKey = asOctetKey(properties.getAuth().getPublicKey());
      }
    } catch (JOSEException error) {
      throw new IllegalStateException("Failed to initialize JWT keys", error);
    }
  }

  private static OctetKeyPair asOctetKey(String configured) throws JOSEException {
    String value = configured.trim();
    String pem =
        value.contains("BEGIN ")
            ? value.replace("\\n", "\n")
            : new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    JWK jwk = JWK.parseFromPEMEncodedObjects(pem);
    if (!(jwk instanceof OctetKeyPair pair)) {
      throw new JOSEException("Expected an Ed25519 key");
    }
    return pair;
  }

  public AccessToken createAccessToken(String userId, String deviceId, long authVersion, long deviceAuthVersion) {
    Instant now = Instant.now();
    Instant expiresAt = now.plusSeconds(properties.getAuth().getAccessTtlSeconds());
    JWTClaimsSet claims =
        new JWTClaimsSet.Builder()
            .issuer(properties.getAuth().getIssuer())
            .audience(properties.getAuth().getAudience())
            .issueTime(Date.from(now))
            .expirationTime(Date.from(expiresAt))
            .jwtID(Ids.uuidv7())
            .claim("uid", userId)
            .claim("did", deviceId)
            .claim("authVersion", authVersion)
            .claim("deviceAuthVersion", deviceAuthVersion)
            .build();
    try {
      SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.EdDSA), claims);
      jwt.sign(new Ed25519Signer(privateKey));
      return new AccessToken(jwt.serialize(), properties.getAuth().getAccessTtlSeconds());
    } catch (JOSEException error) {
      throw new IllegalStateException("Failed to sign access token", error);
    }
  }

  public Claims verify(String token) {
    try {
      SignedJWT jwt = SignedJWT.parse(token);
      if (!JWSAlgorithm.EdDSA.equals(jwt.getHeader().getAlgorithm())
          || !jwt.verify(new Ed25519Verifier(publicKey))) {
        throw ApiException.unauthorized("访问令牌无效或已过期");
      }
      JWTClaimsSet claims = jwt.getJWTClaimsSet();
      Instant now = Instant.now();
      if (claims.getExpirationTime() == null || claims.getExpirationTime().toInstant().isBefore(now)) {
        throw ApiException.unauthorized("访问令牌无效或已过期");
      }
      if (!properties.getAuth().getIssuer().equals(claims.getIssuer())
          || claims.getAudience() == null
          || !claims.getAudience().contains(properties.getAuth().getAudience())) {
        throw ApiException.unauthorized("访问令牌无效或已过期");
      }
      Object uid = claims.getClaim("uid");
      Object did = claims.getClaim("did");
      Object authVersion = claims.getClaim("authVersion");
      Object deviceAuthVersion = claims.getClaim("deviceAuthVersion");
      if (!(uid instanceof String)
          || !(did instanceof String)
          || !(authVersion instanceof Number)
          || !(deviceAuthVersion instanceof Number)) {
        throw ApiException.unauthorized("访问令牌无效或已过期");
      }
      return new Claims(
          (String) uid,
          (String) did,
          ((Number) authVersion).longValue(),
          ((Number) deviceAuthVersion).longValue());
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw ApiException.unauthorized("访问令牌无效或已过期");
    }
  }

  public String newRefreshToken() {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  public String hashRefreshToken(String token) {
    try {
      return java.util.HexFormat.of()
          .formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  public record AccessToken(String token, int expiresIn) {}
}
