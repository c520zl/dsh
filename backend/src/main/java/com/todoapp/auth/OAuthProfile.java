package com.todoapp.auth;

public record OAuthProfile(
    String provider, String subject, String email, Boolean emailVerified, String name) {}
