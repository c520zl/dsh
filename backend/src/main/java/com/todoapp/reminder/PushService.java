package com.todoapp.reminder;

import com.todoapp.auth.Device;
import com.todoapp.config.AppProperties;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
public class PushService {
  private static final Logger log = LoggerFactory.getLogger(PushService.class);
  private final AppProperties properties;
  private final RestClient client = RestClient.builder().baseUrl("https://exp.host").build();

  public PushService(AppProperties properties) {
    this.properties = properties;
  }

  public boolean send(Device device, String title, String body, Map<String, String> data) {
    if (!properties.getPush().isEnabled()) {
      log.info("[push disabled] device={} title={}", device.getId(), title);
      return true;
    }
    if (!"expo".equalsIgnoreCase(properties.getPush().getDriver())
        && !"expo".equalsIgnoreCase(device.getPushProvider())) {
      log.warn("Push provider {} is not implemented", device.getPushProvider());
      return false;
    }
    try {
      var response =
          client
              .post()
              .uri("/--/api/v2/push/send")
              .body(
                  Map.of(
                      "to", device.getPushToken(),
                      "title", title,
                      "body", body,
                      "data", data,
                      "sound", "default"))
              .retrieve()
              .body(Map.class);
      if (response == null) {
        return false;
      }
      Object dataNode = response.get("data");
      if (dataNode instanceof Map<?, ?> map) {
        Object status = map.get("status");
        return status == null || "ok".equals(status);
      }
      return true;
    } catch (RuntimeException error) {
      log.warn("Push delivery failed for device {}: {}", device.getId(), error.getMessage());
      return false;
    }
  }
}
