package com.todoapp.auth;

import com.todoapp.common.ApiException;
import com.todoapp.common.TimeUtils;
import com.todoapp.config.AppProperties;
import com.todoapp.mapper.IdentityMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Locale;
import org.springframework.stereotype.Service;

@Service
public class OtpService {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final IdentityMapper identityMapper;
  private final Mailer mailer;
  private final AppProperties properties;

  public OtpService(IdentityMapper identityMapper, Mailer mailer, AppProperties properties) {
    this.identityMapper = identityMapper;
    this.mailer = mailer;
    this.properties = properties;
  }

  public void issue(String emailInput, String ip) {
    String email = emailInput.toLowerCase(Locale.ROOT);
    LocalDateTime now = TimeUtils.nowUtc();
    OtpCode existing = identityMapper.selectOtp(email);
    if (existing != null && existing.getLastSentAt() != null) {
      LocalDateTime availableAt =
          existing.getLastSentAt().plusSeconds(properties.getAuth().getOtpResendCooldownSeconds());
      if (availableAt.isAfter(now)) {
        long retryAfter = Math.max(1, ChronoUnit.SECONDS.between(now, availableAt));
        throw ApiException.rateLimited("验证码发送过于频繁，请稍后重试", retryAfter);
      }
    }

    LocalDateTime hourStart = now.truncatedTo(ChronoUnit.HOURS);
    enforceHourly("otp:email:" + email, hourStart, properties.getAuth().getOtpEmailHourlyLimit());
    enforceHourly("otp:ip:" + ip, hourStart, properties.getAuth().getOtpIpHourlyLimit());

    int max = (int) Math.pow(10, properties.getAuth().getOtpLength());
    String code = String.format("%0" + properties.getAuth().getOtpLength() + "d", RANDOM.nextInt(max));
    OtpCode otp = new OtpCode();
    otp.setEmail(email);
    otp.setCodeHash(hash(email, code));
    otp.setAttempts(0);
    otp.setExpiresAt(now.plusSeconds(properties.getAuth().getOtpTtlSeconds()));
    otp.setLastSentAt(now);
    identityMapper.upsertOtp(otp);
    try {
      mailer.sendOtp(email, code);
    } catch (RuntimeException error) {
      identityMapper.deleteOtp(email);
      throw error;
    }
  }

  public void verify(String emailInput, String code) {
    String email = emailInput.toLowerCase(Locale.ROOT);
    OtpCode otp = identityMapper.selectOtp(email);
    LocalDateTime now = TimeUtils.nowUtc();
    if (otp == null
        || otp.getCodeHash() == null
        || otp.getCodeHash().isBlank()
        || otp.getExpiresAt() == null
        || otp.getExpiresAt().isBefore(now)) {
      throw ApiException.unauthorized("验证码无效或已过期");
    }
    if (otp.getAttempts() != null && otp.getAttempts() >= properties.getAuth().getOtpMaxAttempts()) {
      identityMapper.deleteOtp(email);
      throw ApiException.unauthorized("验证码尝试次数过多，请重新获取");
    }
    if (!otp.getCodeHash().equals(hash(email, code))) {
      int attempts = (otp.getAttempts() == null ? 0 : otp.getAttempts()) + 1;
      identityMapper.updateOtpAttempts(email, attempts);
      throw ApiException.unauthorized("验证码无效或已过期");
    }
    identityMapper.consumeOtp(email, now);
  }

  private void enforceHourly(String key, LocalDateTime windowStart, int limit) {
    identityMapper.incrementRateLimit(key, windowStart);
    Integer count = identityMapper.selectRateLimit(key, windowStart);
    if (count != null && count > limit) {
      throw ApiException.rateLimited("请求过于频繁，请稍后重试", 3600);
    }
  }

  private String hash(String email, String code) {
    try {
      String source = email + ":" + code + ":" + properties.getAuditIpSalt();
      return HexFormat.of()
          .formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }
}
