package com.todoapp.auth.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class OtpVerifyRequest {
  @NotBlank
  @Email
  private String email;

  @NotBlank
  @Pattern(regexp = "[0-9]{6}")
  private String code;

  @NotNull
  @Valid
  private DeviceInfo device;
}
