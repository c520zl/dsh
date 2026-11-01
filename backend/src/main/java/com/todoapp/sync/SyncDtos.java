package com.todoapp.sync;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

public final class SyncDtos {
  private SyncDtos() {}

  public record SnapshotResponse(long cursor) {}

  public record LocalDelivery(
      @NotBlank String reminderId,
      @NotBlank String occurrenceKey,
      @NotBlank String deliveredAt) {}

  public record SyncOp(
      @NotBlank String opId,
      @NotBlank @Pattern(regexp = "task|list|tag") String entity,
      @NotBlank String entityId,
      @NotBlank @Pattern(regexp = "create|update|delete|complete|uncomplete") String op,
      @Min(0) Long baseVersion,
      JsonNode patch,
      String occurrenceKey,
      String completionId) {}

  public record PushRequest(
      @NotBlank String deviceId,
      @Size(max = 100) List<@Valid LocalDelivery> localDeliveries,
      @NotNull @Size(min = 1, max = 100) List<@Valid SyncOp> ops) {}

  public record OpResult(
      String opId,
      String status,
      Long version,
      List<String> conflictFields,
      Object task,
      Map<String, Object> error) {}

  public record PushResponse(List<OpResult> results) {}

  public record Change(
      long seq,
      String entity,
      String entityId,
      String op,
      long version,
      Map<String, Object> changedFields) {}

  public record PullResponse(List<Change> changes, long nextCursor, boolean hasMore) {}
}
