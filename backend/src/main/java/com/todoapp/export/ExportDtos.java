package com.todoapp.export;

import com.todoapp.common.TimeUtils;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

public final class ExportDtos {
  private ExportDtos() {}

  public record ExportJobDto(
      String id,
      String status,
      String format,
      String downloadUrl,
      String expiresAt,
      String error,
      String createdAt) {
    public static ExportJobDto from(ExportJob job, String publicBaseUrl) {
      boolean ready = "ready".equals(job.getStatus())
          && job.getExpiresAt() != null
          && job.getExpiresAt().isAfter(TimeUtils.nowUtc());
      return new ExportJobDto(
          job.getId(),
          job.getStatus(),
          job.getFileFormat(),
          ready ? publicBaseUrl + "/v1/export/" + job.getId() + "/download" : null,
          job.getExpiresAt() == null ? null : TimeUtils.iso(job.getExpiresAt()),
          job.getError(),
          job.getCreatedAt() == null ? null : TimeUtils.iso(job.getCreatedAt()));
    }
  }

  @Data
  public static class CreateExport {
    @NotBlank
    @Pattern(regexp = "json|csv")
    private String format;
  }
}
