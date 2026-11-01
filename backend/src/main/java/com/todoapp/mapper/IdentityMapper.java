package com.todoapp.mapper;

import com.todoapp.auth.AuthIdentity;
import com.todoapp.auth.Device;
import com.todoapp.auth.OtpCode;
import com.todoapp.auth.RefreshToken;
import com.todoapp.auth.User;
import com.todoapp.me.UserSettings;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface IdentityMapper {
  User selectUserById(@Param("id") String id);

  User selectActiveUserByEmail(@Param("email") String email);

  User selectAnyUserByEmail(@Param("email") String email);

  int insertUser(User user);

  int updateUser(User user);

  int updateUserAuthVersion(@Param("id") String id, @Param("authVersion") long authVersion);

  int softDeleteUser(@Param("id") String id, @Param("deletedAt") LocalDateTime deletedAt);

  AuthIdentity selectIdentity(
      @Param("provider") String provider, @Param("providerUserId") String providerUserId);

  int insertIdentity(AuthIdentity identity);

  UserSettings selectSettings(@Param("userId") String userId);

  int insertSettings(UserSettings settings);

  int updateSettings(UserSettings settings);

  Device selectDevice(@Param("id") String id);

  Device selectDeviceForUser(@Param("id") String id, @Param("userId") String userId);

  Device selectMatchingDevice(
      @Param("userId") String userId,
      @Param("name") String name,
      @Param("platform") String platform,
      @Param("appVersion") String appVersion,
      @Param("osVersion") String osVersion);

  List<Device> selectDevices(
      @Param("userId") String userId, @Param("includeRevoked") boolean includeRevoked);

  List<Device> selectActiveDevices(@Param("userId") String userId);

  int countActiveDevices(@Param("userId") String userId);

  int insertDevice(Device device);

  int updateDevice(Device device);

  int updateDeviceLastSeen(
      @Param("id") String id, @Param("lastSeenAt") LocalDateTime lastSeenAt);

  int revokeDevice(@Param("id") String id, @Param("revokedAt") LocalDateTime revokedAt);

  int revokeAllDevices(
      @Param("userId") String userId, @Param("revokedAt") LocalDateTime revokedAt);

  RefreshToken selectRefreshTokenByHash(@Param("tokenHash") String tokenHash);

  RefreshToken selectRefreshTokenForUpdate(@Param("id") String id);

  int insertRefreshToken(RefreshToken token);

  int rotateRefreshToken(
      @Param("id") String id,
      @Param("replacedById") String replacedById,
      @Param("rotatedAt") LocalDateTime rotatedAt);

  int revokeTokenFamily(
      @Param("familyId") String familyId, @Param("revokedAt") LocalDateTime revokedAt);

  int revokeTokensForDevice(
      @Param("userId") String userId,
      @Param("deviceId") String deviceId,
      @Param("revokedAt") LocalDateTime revokedAt);

  int revokeAllTokensForUser(
      @Param("userId") String userId, @Param("revokedAt") LocalDateTime revokedAt);

  OtpCode selectOtp(@Param("email") String email);

  int upsertOtp(OtpCode otp);

  int updateOtpAttempts(@Param("email") String email, @Param("attempts") int attempts);

  int deleteOtp(@Param("email") String email);

  int consumeOtp(@Param("email") String email, @Param("now") LocalDateTime now);

  int incrementRateLimit(
      @Param("bucket") String bucket, @Param("windowStart") LocalDateTime windowStart);

  Integer selectRateLimit(
      @Param("bucket") String bucket, @Param("windowStart") LocalDateTime windowStart);

  int deleteExpiredRateLimits(@Param("before") LocalDateTime before);

  int deleteExpiredOtps(@Param("before") LocalDateTime before);

  int deleteDeletedUsersBefore(@Param("before") LocalDateTime before);
}
