package com.todoapp.auth;

public interface OAuthVerifier {
  OAuthProfile verify(String provider, String identityToken);
}
