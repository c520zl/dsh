package com.todoapp.auth;

import com.todoapp.auth.dto.AuthResponse;
import com.todoapp.auth.dto.OAuthRequest;
import com.todoapp.auth.dto.OtpRequest;
import com.todoapp.auth.dto.OtpVerifyRequest;
import com.todoapp.auth.dto.RefreshRequest;
import com.todoapp.common.AuthPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/auth")
public class AuthController {
  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/otp/request")
  public ResponseEntity<Map<String, String>> requestOtp(
      @Valid @RequestBody OtpRequest body, HttpServletRequest request) {
    authService.requestOtp(body.getEmail(), request.getRemoteAddr());
    return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("message", "验证码已发送"));
  }

  @PostMapping("/otp/verify")
  public AuthResponse verifyOtp(
      @Valid @RequestBody OtpVerifyRequest body, HttpServletRequest request) {
    return authService.verifyOtp(
        body.getEmail(), body.getCode(), body.getDevice(), request.getRemoteAddr());
  }

  @PostMapping("/oauth/apple")
  public AuthResponse loginWithApple(
      @Valid @RequestBody OAuthRequest body, HttpServletRequest request) {
    return authService.loginWithOAuth("apple", body.getIdentityToken(), body.getDevice(), request.getRemoteAddr());
  }

  @PostMapping("/oauth/google")
  public AuthResponse loginWithGoogle(
      @Valid @RequestBody OAuthRequest body, HttpServletRequest request) {
    return authService.loginWithOAuth("google", body.getIdentityToken(), body.getDevice(), request.getRemoteAddr());
  }

  @PostMapping("/refresh")
  public AuthResponse refresh(@Valid @RequestBody RefreshRequest body) {
    return authService.refresh(body.getRefreshToken());
  }

  @PostMapping("/logout")
  public ResponseEntity<Void> logout(
      @AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request) {
    authService.logout(principal.userId(), principal.deviceId(), request.getRemoteAddr());
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/logout-all")
  public ResponseEntity<Void> logoutAll(
      @AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request) {
    authService.logoutAll(principal.userId(), request.getRemoteAddr());
    return ResponseEntity.noContent().build();
  }
}
