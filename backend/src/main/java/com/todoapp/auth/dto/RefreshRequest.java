package com.todoapp.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class RefreshRequest {
  @NotBlank
  @Size(min = 20)
  private String refreshToken;
}
