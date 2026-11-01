package com.todoapp.auth;

import com.todoapp.common.ApiException;
import com.todoapp.common.AuthPrincipal;
import com.todoapp.common.TimeUtils;
import com.todoapp.mapper.IdentityMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDateTime;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {
  private final TokenService tokens;
  private final IdentityMapper identityMapper;

  public JwtAuthFilter(TokenService tokens, IdentityMapper identityMapper) {
    this.tokens = tokens;
    this.identityMapper = identityMapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String token = extractToken(request);
    if (token != null) {
      try {
        TokenService.Claims claims = tokens.verify(token);
        User user = identityMapper.selectUserById(claims.uid());
        Device device = identityMapper.selectDeviceForUser(claims.did(), claims.uid());
        if (user == null || user.getDeletedAt() != null || user.getAuthVersion() != claims.authVersion()) {
          throw ApiException.unauthorized("访问令牌已失效");
        }
        if (device == null || device.getRevokedAt() != null || device.getAuthVersion() != claims.deviceAuthVersion()) {
          throw ApiException.unauthorized("设备已被移除或令牌已失效");
        }
        AuthPrincipal principal = new AuthPrincipal(user.getId(), device.getId());
        SecurityContextHolder.getContext()
            .setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, java.util.List.of()));
        LocalDateTime fiveMinutesAgo = TimeUtils.nowUtc().minusMinutes(5);
        if (device.getLastSeenAt() == null || device.getLastSeenAt().isBefore(fiveMinutesAgo)) {
          identityMapper.updateDeviceLastSeen(device.getId(), TimeUtils.nowUtc());
        }
      } catch (ApiException error) {
        request.setAttribute("todo.authError", error.getMessage());
        SecurityContextHolder.clearContext();
      }
    }
    filterChain.doFilter(request, response);
  }

  private static String extractToken(HttpServletRequest request) {
    String authorization = request.getHeader("Authorization");
    if (authorization != null) {
      String[] parts = authorization.split(" ", 2);
      if (parts.length == 2 && parts[0].equalsIgnoreCase("Bearer") && !parts[1].isBlank()) {
        return parts[1];
      }
    }
    Cookie[] cookies = request.getCookies();
    if (cookies != null) {
      for (Cookie cookie : cookies) {
        if ("todo_session".equals(cookie.getName()) && !cookie.getValue().isBlank()) {
          return cookie.getValue();
        }
      }
    }
    return null;
  }
}
