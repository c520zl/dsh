package com.todoapp.device;

import com.todoapp.auth.Device;
import com.todoapp.common.TimeUtils;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

public final class DeviceDtos {
  private DeviceDtos() {}

  public record DeviceDto(
      String id,
      String name,
      String platform,
      String pushProvider,
      String lastSeenAt,
      String revokedAt,
      String createdAt) {
    public static DeviceDto from(Device device) {
      return new DeviceDto(
          device.getId(),
          device.getName(),
          device.getPlatform(),
          device.getPushProvider(),
          device.getLastSeenAt() == null ? null : TimeUtils.iso(device.getLastSeenAt()),
          device.getRevokedAt() == null ? null : TimeUtils.iso(device.getRevokedAt()),
          device.getCreatedAt() == null ? null : TimeUtils.iso(device.getCreatedAt()));
    }
  }

  @Data
  public static class UpdateDevice {
    @Size(min = 1, max = 100)
    private String name;

    @Size(max = 512)
    private String pushToken;

    @Pattern(regexp = "apns|fcm|expo|huawei|xiaomi|oppo|vivo|jpush|getui")
    private String pushProvider;
  }
}
