package com.todoapp.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "app")
public class AppProperties {
  private final Auth auth = new Auth();
  private final Mail mail = new Mail();
  private final Push push = new Push();
  private final Export export = new Export();
  private final Limits limits = new Limits();
  private final Retention retention = new Retention();
  private final Worker worker = new Worker();
  private String auditIpSalt = "todo-app-local-salt";

  @Data
  public static class Auth {
    private String issuer = "todo-api";
    private String audience = "todo-app";
    private int accessTtlSeconds = 900;
    private int refreshTtlDays = 30;
    private String privateKey = "";
    private String publicKey = "";
    private int maxDevices = 10;
    private int otpLength = 6;
    private int otpTtlSeconds = 300;
    private int otpMaxAttempts = 5;
    private int otpResendCooldownSeconds = 60;
    private int otpEmailHourlyLimit = 10;
    private int otpIpHourlyLimit = 30;
    private String googleClientId = "";
    private String appleClientId = "";
  }

  @Data
  public static class Mail {
    private String driver = "log";
    private String from = "Todo App <no-reply@todo-app.test>";
    private String resendApiKey = "";
  }

  @Data
  public static class Push {
    private boolean enabled = false;
    private String driver = "log";
  }

  @Data
  public static class Export {
    private String storageDir = "./storage";
    private String publicBaseUrl = "http://127.0.0.1:3000";
    private int ttlHours = 24;
  }

  @Data
  public static class Limits {
    private int perMinute = 120;
    private int syncPerMinute = 20;
  }

  @Data
  public static class Retention {
    private int trashDays = 30;
    private int changeLogDays = 30;
    private int processedOpsDays = 30;
    private int reminderDays = 7;
    private int auditDays = 180;
    private int userDeletionDays = 30;
  }

  @Data
  public static class Worker {
    private boolean enabled = true;
    private long reminderTickMs = 5000;
    private long exportTickMs = 5000;
    private long cleanupTickMs = 3600000;
  }
}
