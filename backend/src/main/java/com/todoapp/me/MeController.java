package com.todoapp.me;

import com.todoapp.common.AuthPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/me")
public class MeController {
  private final MeService meService;

  public MeController(MeService meService) {
    this.meService = meService;
  }

  @GetMapping
  public MeDtos.MeResponse get(@AuthenticationPrincipal AuthPrincipal principal) {
    return meService.get(principal.userId());
  }

  @PatchMapping
  public MeDtos.MeResponse update(
      @AuthenticationPrincipal AuthPrincipal principal, @Valid @RequestBody MeDtos.UpdateMe body) {
    return meService.update(principal.userId(), body);
  }

  @DeleteMapping
  public ResponseEntity<MeDtos.DeleteAccountResponse> delete(
      @AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(meService.delete(principal.userId(), request.getRemoteAddr()));
  }
}
