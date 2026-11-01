package com.todoapp.auth;

import com.todoapp.auth.dto.AuthResponse;
import com.todoapp.auth.dto.DeviceInfo;
import com.todoapp.auth.dto.UserDto;
import com.todoapp.common.ApiException;
import com.todoapp.common.Ids;
import com.todoapp.common.TimeUtils;
import com.todoapp.config.AppProperties;
import com.todoapp.mapper.IdentityMapper;
import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {
  private static final Logger log = LoggerFactory.getLogger(AuthService.class);

  private final IdentityMapper identityMapper;
  private final TokenService tokens;
  private final OtpService otpService;
  private final OAuthVerifier oauthVerifier;
  private final UserProvisioningService provisioning;
  private final AuditService audit;
  private final AppProperties properties;
  private final TransactionTemplate transactionTemplate;
  private final TransactionTemplate replayTransactionTemplate;

  public AuthService(
      IdentityMapper identityMapper,
      TokenService tokens,
      OtpService otpService,
      OAuthVerifier oauthVerifier,
      UserProvisioningService provisioning,
      AuditService audit,
      AppProperties properties,
      PlatformTransactionManager transactionManager) {
    this.identityMapper = identityMapper;
    this.tokens = tokens;
    this.otpService = otpService;
    this.oauthVerifier = oauthVerifier;
    this.provisioning = provisioning;
    this.audit = audit;
    this.properties = properties;
    this.transactionTemplate = new TransactionTemplate(transactionManager);
    this.replayTransactionTemplate = new TransactionTemplate(transactionManager);
    this.replayTransactionTemplate.setPropagationBehavior(
        org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public void requestOtp(String email, String ip) {
    otpService.issue(email, ip);
    audit.record(null, "otp_requested", ip, Map.of());
  }

  @Transactional
  public AuthResponse verifyOtp(String emailInput, String code, DeviceInfo device, String ip) {
    String email = emailInput.toLowerCase(Locale.ROOT);
    otpService.verify(email, code);

    User user = identityMapper.selectActiveUserByEmail(email);
    if (user == null) {
      User any = identityMapper.selectAnyUserByEmail(email);
      if (any != null && any.getDeletedAt() != null) {
        throw ApiException.unauthorized("登录失败");
      }
      user =
          provisioning.createUser(
              email, displayNameFromEmail(email), "email", email);
    }
    AuthResponse response = establishSession(user, device);
    audit.record(user.getId(), "login_otp", ip, Map.of("deviceId", response.deviceId()));
    return response;
  }

  @Transactional
  public AuthResponse loginWithOAuth(
      String provider, String identityToken, DeviceInfo device, String ip) {
    OAuthProfile profile = oauthVerifier.verify(provider, identityToken);
    if (profile.email() != null && Boolean.FALSE.equals(profile.emailVerified())) {
      throw ApiException.unauthorized("第三方邮箱未验证");
    }

    AuthIdentity identity = identityMapper.selectIdentity(provider, profile.subject());
    User user = null;
    if (identity != null) {
      user = identityMapper.selectUserById(identity.getUserId());
      if (user == null || user.getDeletedAt() != null) {
        user = null;
      }
    }

    if (user == null && profile.email() != null) {
      user = identityMapper.selectActiveUserByEmail(profile.email());
      if (user != null) {
        try {
          AuthIdentity link = new AuthIdentity();
          link.setId(Ids.uuidv7());
          link.setUserId(user.getId());
          link.setProvider(provider);
          link.setProviderUserId(profile.subject());
          identityMapper.insertIdentity(link);
        } catch (DuplicateKeyException ignored) {
          // Concurrent linking is idempotent.
        }
      } else {
        User any = identityMapper.selectAnyUserByEmail(profile.email());
        if (any != null && any.getDeletedAt() != null) {
          throw ApiException.unauthorized("登录失败");
        }
      }
    }

    if (user == null) {
      if (profile.email() == null) {
        throw ApiException.unauthorized("无法获取第三方账号邮箱，请使用邮箱验证码登录");
      }
      try {
        user =
            provisioning.createUser(
                profile.email(),
                profile.name() == null || profile.name().isBlank()
                    ? displayNameFromEmail(profile.email())
                    : profile.name().trim().substring(0, Math.min(50, profile.name().trim().length())),
                provider,
                profile.subject());
      } catch (DuplicateKeyException error) {
        user = identityMapper.selectActiveUserByEmail(profile.email());
        if (user == null) {
          throw ApiException.unauthorized("登录失败");
        }
      }
    }

    AuthResponse response = establishSession(user, device);
    audit.record(user.getId(), "login_" + provider, ip, Map.of("deviceId", response.deviceId()));
    return response;
  }

  public AuthResponse refresh(String refreshToken) {
    String hash = tokens.hashRefreshToken(refreshToken);
    RefreshToken token = identityMapper.selectRefreshTokenByHash(hash);
    if (token == null) {
      throw ApiException.unauthorized("刷新令牌无效");
    }
    if (token.getRevokedAt() != null || token.getRotatedAt() != null) {
      revokeFamilyForReplay(token);
      throw ApiException.unauthorized("刷新令牌已失效，请重新登录");
    }
    if (token.getExpiresAt() == null || token.getExpiresAt().isBefore(TimeUtils.nowUtc())) {
      throw ApiException.unauthorized("刷新令牌已过期");
    }
    User user = identityMapper.selectUserById(token.getUserId());
    Device device = identityMapper.selectDeviceForUser(token.getDeviceId(), token.getUserId());
    if (user == null || user.getDeletedAt() != null || device == null || device.getRevokedAt() != null) {
      throw ApiException.unauthorized("会话已失效");
    }

    String newToken = tokens.newRefreshToken();
    String newTokenId = Ids.uuidv7();
    Boolean rotated =
        transactionTemplate.execute(
            status -> {
              RefreshToken locked = identityMapper.selectRefreshTokenForUpdate(token.getId());
              if (locked == null || locked.getRotatedAt() != null || locked.getRevokedAt() != null) {
                return false;
              }
              RefreshToken replacement = new RefreshToken();
              replacement.setId(newTokenId);
              replacement.setUserId(token.getUserId());
              replacement.setDeviceId(token.getDeviceId());
              replacement.setFamilyId(token.getFamilyId());
              replacement.setTokenHash(tokens.hashRefreshToken(newToken));
              replacement.setExpiresAt(
                  TimeUtils.nowUtc().plusDays(properties.getAuth().getRefreshTtlDays()));
              identityMapper.insertRefreshToken(replacement);
              identityMapper.rotateRefreshToken(token.getId(), newTokenId, TimeUtils.nowUtc());
              return true;
            });
    if (!Boolean.TRUE.equals(rotated)) {
      revokeFamilyForReplay(token);
      throw ApiException.unauthorized("刷新令牌已失效，请重新登录");
    }
    TokenService.AccessToken access =
        tokens.createAccessToken(user.getId(), device.getId(), user.getAuthVersion(), device.getAuthVersion());
    return new AuthResponse(
        access.token(), newToken, access.expiresIn(), device.getId(), UserDto.from(user));
  }

  @Transactional
  public void logout(String userId, String deviceId, String ip) {
    Device device = identityMapper.selectDeviceForUser(deviceId, userId);
    if (device == null) {
      throw ApiException.notFound("设备不存在");
    }
    LocalDateTime now = TimeUtils.nowUtc();
    identityMapper.revokeTokensForDevice(userId, deviceId, now);
    device.setAuthVersion(device.getAuthVersion() + 1);
    device.setPushToken(null);
    device.setPushProvider(null);
    identityMapper.updateDevice(device);
    audit.record(userId, "logout", ip, Map.of("deviceId", deviceId));
  }

  @Transactional
  public void logoutAll(String userId, String ip) {
    LocalDateTime now = TimeUtils.nowUtc();
    identityMapper.revokeAllTokensForUser(userId, now);
    User user = identityMapper.selectUserById(userId);
    if (user != null) {
      identityMapper.updateUserAuthVersion(userId, user.getAuthVersion() + 1);
    }
    for (Device device : identityMapper.selectDevices(userId, false)) {
      device.setAuthVersion(device.getAuthVersion() + 1);
      device.setPushToken(null);
      device.setPushProvider(null);
      identityMapper.updateDevice(device);
    }
    audit.record(userId, "logout_all", ip, Map.of());
  }

  private AuthResponse establishSession(User user, DeviceInfo info) {
    Device device = identityMapper.selectMatchingDevice(
        user.getId(), info.getName(), info.getPlatform(), info.getAppVersion(), info.getOsVersion());
    if (device == null) {
      int active = identityMapper.countActiveDevices(user.getId());
      if (active >= properties.getAuth().getMaxDevices()) {
        throw ApiException.forbidden("登录设备数量已达上限，请移除旧设备后重试");
      }
      device = new Device();
      device.setId(Ids.uuidv7());
      device.setUserId(user.getId());
      device.setName(info.getName());
      device.setPlatform(info.getPlatform());
      device.setAppVersion(info.getAppVersion());
      device.setOsVersion(info.getOsVersion());
      device.setAuthVersion(1L);
      device.setLastSeenAt(TimeUtils.nowUtc());
      identityMapper.insertDevice(device);
    } else {
      device.setLastSeenAt(TimeUtils.nowUtc());
      identityMapper.updateDeviceLastSeen(device.getId(), device.getLastSeenAt());
    }

    String refreshToken = tokens.newRefreshToken();
    RefreshToken token = new RefreshToken();
    token.setId(Ids.uuidv7());
    token.setUserId(user.getId());
    token.setDeviceId(device.getId());
    token.setFamilyId(Ids.uuidv7());
    token.setTokenHash(tokens.hashRefreshToken(refreshToken));
    token.setExpiresAt(TimeUtils.nowUtc().plusDays(properties.getAuth().getRefreshTtlDays()));
    identityMapper.insertRefreshToken(token);

    TokenService.AccessToken access =
        tokens.createAccessToken(user.getId(), device.getId(), user.getAuthVersion(), device.getAuthVersion());
    return new AuthResponse(
        access.token(), refreshToken, access.expiresIn(), device.getId(), UserDto.from(user));
  }

  private void revokeFamilyForReplay(RefreshToken token) {
    replayTransactionTemplate.execute(
        status -> {
          LocalDateTime now = TimeUtils.nowUtc();
          identityMapper.revokeTokenFamily(token.getFamilyId(), now);
          Device device = identityMapper.selectDeviceForUser(token.getDeviceId(), token.getUserId());
          if (device != null) {
            device.setAuthVersion(device.getAuthVersion() + 1);
            identityMapper.updateDevice(device);
          }
          audit.record(
              token.getUserId(),
              "refresh_replay",
              null,
              Map.of("familyId", token.getFamilyId(), "deviceId", token.getDeviceId()));
          return true;
        });
    log.warn("Refresh token replay detected for user={}; family revoked", token.getUserId());
  }

  private static String displayNameFromEmail(String email) {
    int at = email.indexOf('@');
    String local = at > 0 ? email.substring(0, at) : email;
    String trimmed = local.trim();
    return (trimmed.isEmpty() ? "用户" : trimmed.substring(0, Math.min(50, trimmed.length())));
  }
}
