package com.todoapp.auth.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class OAuthRequest {
  @NotBlank
  @Size(min = 20)
  private String identityToken;

  @NotNull
  @Valid
  private DeviceInfo device;
}
