package com.todoapp.list;

import com.todoapp.common.AuthPrincipal;
import com.todoapp.common.IdempotencyService;
import com.todoapp.common.Ids;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/lists")
public class ListController {
  private final ListService listService;
  private final IdempotencyService idempotencyService;

  public ListController(ListService listService, IdempotencyService idempotencyService) {
    this.listService = listService;
    this.idempotencyService = idempotencyService;
  }

  @GetMapping
  public List<ListDtos.ListDto> list(
      @AuthenticationPrincipal AuthPrincipal principal,
      @RequestParam(defaultValue = "false") boolean includeArchived) {
    return listService.list(principal.userId(), includeArchived);
  }

  @PostMapping
  public ResponseEntity<Object> create(
      @AuthenticationPrincipal AuthPrincipal principal,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @Valid @RequestBody ListDtos.CreateList body) {
    if (idempotencyKey != null && !Ids.isUuid(idempotencyKey)) {
      throw com.todoapp.common.ApiException.badRequest("Idempotency-Key 必须是 UUID");
    }
    Object result = idempotencyService.run(
        principal.userId(),
        idempotencyKey,
        () -> listService.create(principal.userId(), principal.deviceId(), body));
    return ResponseEntity.status(HttpStatus.CREATED).body(result);
  }

  @PatchMapping("/{listId}")
  public ListDtos.ListDto update(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String listId,
      @Valid @RequestBody ListDtos.UpdateList body) {
    return listService.update(principal.userId(), principal.deviceId(), Ids.requireUuid(listId, "listId"), body);
  }

  @DeleteMapping("/{listId}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String listId,
      @RequestBody(required = false) ListDtos.DeleteList body) {
    listService.delete(principal.userId(), principal.deviceId(), Ids.requireUuid(listId, "listId"), body);
    return ResponseEntity.noContent().build();
  }
}
