package com.todoapp.auth.dto;

public record AuthResponse(
    String accessToken,
    String refreshToken,
    int expiresIn,
    String deviceId,
    UserDto user) {}
