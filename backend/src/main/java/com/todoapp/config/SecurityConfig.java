package com.todoapp.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.todoapp.auth.JwtAuthFilter;
import com.todoapp.common.ErrorCode;
import com.todoapp.common.ErrorResponse;
import com.todoapp.common.RequestIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
  @Bean
  SecurityFilterChain securityFilterChain(
      HttpSecurity http, JwtAuthFilter jwtAuthFilter, ObjectMapper objectMapper) throws Exception {
    AuthenticationEntryPoint entryPoint =
        (request, response, error) -> writeError(request, response, objectMapper, 401, ErrorCode.UNAUTHENTICATED);
    AccessDeniedHandler deniedHandler =
        (request, response, error) -> writeError(request, response, objectMapper, 403, ErrorCode.FORBIDDEN);

    http.csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .formLogin(form -> form.disable())
        .httpBasic(basic -> basic.disable())
        .logout(logout -> logout.disable())
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers("/v1/auth/**", "/v1/health", "/error")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(ex -> ex.authenticationEntryPoint(entryPoint).accessDeniedHandler(deniedHandler))
        .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
    return http.build();
  }

  /** The JWT filter is used inside the security chain only, not as a servlet filter. */
  @Bean
  FilterRegistrationBean<JwtAuthFilter> jwtFilterRegistration(JwtAuthFilter filter) {
    FilterRegistrationBean<JwtAuthFilter> registration = new FilterRegistrationBean<>(filter);
    registration.setEnabled(false);
    return registration;
  }

  private static void writeError(
      HttpServletRequest request,
      HttpServletResponse response,
      ObjectMapper objectMapper,
      int status,
      ErrorCode code)
      throws IOException {
    String authError = (String) request.getAttribute("todo.authError");
    String message =
        authError != null
            ? authError
            : status == 401 ? "未认证或令牌失效" : "无权访问";
    response.setStatus(status);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    objectMapper.writeValue(
        response.getOutputStream(),
        ErrorResponse.of(code, message, null, RequestIds.get(request)));
  }
}
