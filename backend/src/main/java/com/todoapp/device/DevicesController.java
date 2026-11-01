package com.todoapp.device;

import com.todoapp.common.AuthPrincipal;
import com.todoapp.common.Ids;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/devices")
public class DevicesController {
  private final DevicesService devicesService;

  public DevicesController(DevicesService devicesService) {
    this.devicesService = devicesService;
  }

  @GetMapping
  public List<DeviceDtos.DeviceDto> list(@AuthenticationPrincipal AuthPrincipal principal) {
    return devicesService.list(principal.userId());
  }

  @PatchMapping("/{deviceId}")
  public DeviceDtos.DeviceDto update(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String deviceId,
      @Valid @RequestBody DeviceDtos.UpdateDevice body,
      HttpServletRequest request) {
    Ids.requireUuid(deviceId, "deviceId");
    return devicesService.update(principal.userId(), deviceId, body, request.getRemoteAddr());
  }

  @DeleteMapping("/{deviceId}")
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String deviceId,
      HttpServletRequest request) {
    Ids.requireUuid(deviceId, "deviceId");
    devicesService.revoke(principal.userId(), deviceId, request.getRemoteAddr());
    return ResponseEntity.noContent().build();
  }
}
