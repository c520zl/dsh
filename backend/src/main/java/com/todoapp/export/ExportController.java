package com.todoapp.export;

import com.todoapp.common.AuthPrincipal;
import com.todoapp.common.Ids;
import jakarta.validation.Valid;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/export")
public class ExportController {
  private final ExportService exportService;

  public ExportController(ExportService exportService) {
    this.exportService = exportService;
  }

  @PostMapping
  public ResponseEntity<ExportDtos.ExportJobDto> create(
      @AuthenticationPrincipal AuthPrincipal principal,
      @Valid @RequestBody ExportDtos.CreateExport body,
      jakarta.servlet.http.HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(exportService.create(principal.userId(), body.getFormat(), request.getRemoteAddr()));
  }

  @GetMapping("/{exportId}")
  public ExportDtos.ExportJobDto get(
      @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String exportId) {
    return exportService.get(principal.userId(), Ids.requireUuid(exportId, "exportId"));
  }

  @GetMapping("/{exportId}/download")
  public ResponseEntity<Resource> download(
      @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String exportId) {
    ExportService.Download download =
        exportService.download(principal.userId(), Ids.requireUuid(exportId, "exportId"));
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(download.contentType()))
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + download.filename() + "\"")
        .body(download.resource());
  }
}
