package com.todoapp.device;

import com.todoapp.auth.AuditService;
import com.todoapp.auth.Device;
import com.todoapp.common.ApiException;
import com.todoapp.common.TimeUtils;
import com.todoapp.mapper.IdentityMapper;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DevicesService {
  private final IdentityMapper identityMapper;
  private final AuditService audit;

  public DevicesService(IdentityMapper identityMapper, AuditService audit) {
    this.identityMapper = identityMapper;
    this.audit = audit;
  }

  public List<DeviceDtos.DeviceDto> list(String userId) {
    return identityMapper.selectDevices(userId, false).stream().map(DeviceDtos.DeviceDto::from).toList();
  }

  public DeviceDtos.DeviceDto update(String userId, String deviceId, DeviceDtos.UpdateDevice input, String ip) {
    Device device = identityMapper.selectDeviceForUser(deviceId, userId);
    if (device == null || device.getRevokedAt() != null) {
      throw ApiException.notFound("设备不存在");
    }
    if (input.getName() != null && !input.getName().isBlank()) {
      device.setName(input.getName().trim());
    }
    if (input.getPushToken() != null) {
      device.setPushToken(input.getPushToken());
    }
    if (input.getPushProvider() != null) {
      device.setPushProvider(input.getPushProvider());
    }
    identityMapper.updateDevice(device);
    audit.record(userId, "device_updated", ip, Map.of("deviceId", deviceId));
    return DeviceDtos.DeviceDto.from(identityMapper.selectDevice(deviceId));
  }

  @Transactional
  public void revoke(String userId, String deviceId, String ip) {
    Device device = identityMapper.selectDeviceForUser(deviceId, userId);
    if (device == null) {
      throw ApiException.notFound("设备不存在");
    }
    if (device.getRevokedAt() == null) {
      var now = TimeUtils.nowUtc();
      identityMapper.revokeDevice(deviceId, now);
      identityMapper.revokeTokensForDevice(userId, deviceId, now);
      audit.record(userId, "device_revoked", ip, Map.of("deviceId", deviceId));
    }
  }
}
