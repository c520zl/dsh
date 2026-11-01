package com.todoapp.support;

import com.todoapp.auth.Mailer;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class FakeMailer implements Mailer {
  private final Map<String, String> codes = new ConcurrentHashMap<>();

  @Override
  public void sendOtp(String email, String code) {
    codes.put(email.toLowerCase(), code);
  }

  public String codeFor(String email) {
    return codes.get(email.toLowerCase());
  }
}
