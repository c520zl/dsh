package com.todoapp.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Development mail adapter. Production deployments must use a real provider. */
public class LogMailer implements Mailer {
  private static final Logger log = LoggerFactory.getLogger(LogMailer.class);

  @Override
  public void sendOtp(String email, String code) {
    log.warn("[dev mail] OTP for {}: {}", mask(email), code);
  }

  private static String mask(String email) {
    int at = email.indexOf('@');
    if (at <= 0) {
      return "***";
    }
    return email.substring(0, Math.min(2, at)) + "***" + email.substring(at);
  }
}
