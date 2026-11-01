package com.todoapp.sync;

import com.todoapp.common.AuthPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/sync")
@Validated
public class SyncController {
  private final SyncService syncService;

  public SyncController(SyncService syncService) {
    this.syncService = syncService;
  }

  @GetMapping("/snapshot")
  public SyncDtos.SnapshotResponse snapshot(@AuthenticationPrincipal AuthPrincipal principal) {
    return syncService.snapshot(principal.userId());
  }

  @PostMapping("/push")
  public SyncDtos.PushResponse push(
      @AuthenticationPrincipal AuthPrincipal principal,
      @Valid @RequestBody SyncDtos.PushRequest body) {
    return syncService.push(principal.userId(), principal.deviceId(), body);
  }

  @GetMapping("/pull")
  public SyncDtos.PullResponse pull(
      @AuthenticationPrincipal AuthPrincipal principal,
      @RequestParam @Min(0) long since,
      @RequestParam(defaultValue = "500") @Min(1) @Max(500) int limit) {
    return syncService.pull(principal.userId(), since, limit);
  }
}
