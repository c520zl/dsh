package com.todoapp.tag;

import com.todoapp.common.AuthPrincipal;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/tags")
public class TagController {
  private final TagService tagService;

  public TagController(TagService tagService) {
    this.tagService = tagService;
  }

  @GetMapping
  public List<TagDtos.TagDto> list(@AuthenticationPrincipal AuthPrincipal principal) {
    return tagService.list(principal.userId());
  }

  @PostMapping
  public ResponseEntity<TagDtos.TagDto> create(
      @AuthenticationPrincipal AuthPrincipal principal,
      @Valid @RequestBody TagDtos.CreateTag body) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(tagService.create(principal.userId(), principal.deviceId(), body));
  }

  @PatchMapping("/{tagId}")
  public TagDtos.TagDto update(
      @AuthenticationPrincipal AuthPrincipal principal,
      @PathVariable String tagId,
      @Valid @RequestBody TagDtos.UpdateTag body) {
    return tagService.update(
        principal.userId(), principal.deviceId(), Ids.requireUuid(tagId, "tagId"), body);
  }

  @DeleteMapping("/{tagId}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String tagId) {
    tagService.delete(principal.userId(), principal.deviceId(), Ids.requireUuid(tagId, "tagId"));
    return ResponseEntity.noContent().build();
  }
}
