package com.todoapp.common;

import com.todoapp.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class RateLimitInterceptor implements HandlerInterceptor {
  private final RateLimitService limiter = new RateLimitService();
  private final AppProperties properties;

  public RateLimitInterceptor(AppProperties properties) {
    this.properties = properties;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    Instant now = Instant.now();
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    String identity =
        authentication != null && authentication.getPrincipal() instanceof AuthPrincipal principal
            ? "user:" + principal.userId()
            : "ip:" + request.getRemoteAddr();
    String bucket = request.getRequestURI().startsWith("/v1/sync") ? "sync" : "general";
    int limit =
        "sync".equals(bucket) ? properties.getLimits().getSyncPerMinute() : properties.getLimits().getPerMinute();
    if (!limiter.allow(bucket, identity, limit, now)) {
      throw ApiException.rateLimited("请求过于频繁，请稍后重试", limiter.retryAfterSeconds(now));
    }
    if (ThreadLocalRandom.current().nextInt(1000) == 0) {
      limiter.cleanup(now);
    }
    return true;
  }
}
