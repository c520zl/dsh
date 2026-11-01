package com.todoapp.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class DeviceInfo {
  @NotBlank
  @Size(max = 100)
  private String name;

  @NotBlank
  @Pattern(regexp = "ios|android|web")
  private String platform;

  @Size(max = 32)
  private String appVersion;

  @Size(max = 32)
  private String osVersion;
}
