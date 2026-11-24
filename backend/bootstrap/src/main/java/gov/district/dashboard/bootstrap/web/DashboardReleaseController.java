package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.demo.DashboardReleaseService;
import gov.district.dashboard.demo.DashboardReleaseService.Decision;
import gov.district.dashboard.demo.DashboardReleaseService.Workspace;
import gov.district.dashboard.demo.DashboardDraftService;
import gov.district.dashboard.demo.DemoIdentityService.CurrentIdentity;
import gov.district.dashboard.demo.DemoPlaybackService;
import gov.district.dashboard.platform.api.ApiResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
class DashboardReleaseController {

    private final DashboardReleaseService releases;
    private final DemoPlaybackService playback;

    DashboardReleaseController(DashboardReleaseService releases, DemoPlaybackService playback) {
        this.releases = releases;
        this.playback = playback;
    }

    @GetMapping({"/api/v1/admin/dashboards/{projectId}/releases", "/api/v1/dashboard-reviews/{projectId}"})
    ApiResult<Workspace> read(@PathVariable String projectId) {
        return ApiResult.ok(releases.read(projectId));
    }

    @PostMapping("/api/v1/admin/dashboards/{projectId}/releases")
    ApiResult<Workspace> submit(@PathVariable String projectId, @Valid @RequestBody Submission body,
                                @AuthenticationPrincipal CurrentIdentity actor) {
        return ApiResult.ok(releases.submit(projectId, body.revision(), actor.id()));
    }

    @GetMapping("/api/v1/dashboard-reviews/{projectId}/{revision}")
    ApiResult<DashboardDraftService.Workspace> snapshot(@PathVariable String projectId, @PathVariable int revision) {
        var components = releases.snapshot(projectId, revision);
        return ApiResult.ok(new DashboardDraftService.Workspace(DemoPlaybackService.draftTemplate(projectId),
                playback.draftSnapshot(projectId), revision, components));
    }

    @PostMapping("/api/v1/dashboard-reviews/{projectId}")
    ApiResult<Workspace> review(@PathVariable String projectId, @Valid @RequestBody Review body,
                                @AuthenticationPrincipal CurrentIdentity actor) {
        return ApiResult.ok(releases.review(projectId, body.revision(), body.serial(), body.decision(), body.note(), actor.id()));
    }

    record Submission(@NotNull @Min(1) Integer revision) {}

    record Review(@NotNull @Min(0) Integer revision, @NotNull @Min(0) Long serial,
                  @NotNull Decision decision, @Size(max = 400) String note) {}
}
