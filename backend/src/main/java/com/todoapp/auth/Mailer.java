package com.todoapp.auth;

public interface Mailer {
  void sendOtp(String email, String code);
}
