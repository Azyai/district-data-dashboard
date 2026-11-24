package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.demo.DemoIdentityService.CurrentIdentity;
import gov.district.dashboard.demo.DemoPlaybackService;
import gov.district.dashboard.demo.DemoPlaybackService.BatchQueryResult;
import gov.district.dashboard.demo.DemoPlaybackService.Manifest;
import gov.district.dashboard.demo.DemoPlaybackService.ProjectSummary;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import gov.district.dashboard.platform.api.ApiResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
class DemoPlaybackController {

    private static final String TOKEN = "^[a-z][a-z0-9-]{0,63}$";
    private static final java.util.regex.Pattern RELEASE_TOKEN = java.util.regex.Pattern.compile(TOKEN);
    private final DemoPlaybackService playback;

    DemoPlaybackController(DemoPlaybackService playback) {
        this.playback = playback;
    }

    @GetMapping("/api/v1/projects/recommendations")
    ApiResult<List<ProjectSummary>> recommendations(@AuthenticationPrincipal CurrentIdentity identity) {
        return ApiResult.ok(playback.recommendations(identity));
    }

    @GetMapping("/api/v1/playback/{projectId}/manifest")
    ApiResult<Manifest> manifest(@AuthenticationPrincipal CurrentIdentity identity, @PathVariable String projectId) {
        return ApiResult.ok(playback.manifest(identity, projectId));
    }

    @GetMapping("/api/v1/cockpit/topics/{projectId}/manifest")
    ApiResult<Manifest> publicManifest(@PathVariable String projectId) {
        return ApiResult.ok(playback.publicManifest(projectId));
    }

    @GetMapping("/api/v1/cockpit/topics/{projectId}/snapshot")
    ApiResult<BatchQueryResult> publicSnapshot(@PathVariable String projectId,
                                               @RequestParam(required = false) String releaseId) {
        if (releaseId == null || !RELEASE_TOKEN.matcher(releaseId).matches()) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        return ApiResult.ok(playback.publicSnapshot(projectId, releaseId));
    }

    @PostMapping("/api/v1/playback/{projectId}/component-queries")
    ApiResult<BatchQueryResult> query(@AuthenticationPrincipal CurrentIdentity identity, @PathVariable String projectId,
                                     @Valid @RequestBody BatchQueryRequest body) {
        return ApiResult.ok(playback.query(identity, projectId, body.releaseId(), body.componentIds()));
    }

    record BatchQueryRequest(@NotNull @Pattern(regexp = TOKEN) String releaseId,
                             @NotEmpty @Size(max = 20) List<@NotNull @Pattern(regexp = TOKEN) String> componentIds) {
    }
}
