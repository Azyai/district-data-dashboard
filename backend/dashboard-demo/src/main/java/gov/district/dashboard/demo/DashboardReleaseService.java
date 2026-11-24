package gov.district.dashboard.demo;

import gov.district.dashboard.demo.DashboardReleaseMapper.LiveRow;
import gov.district.dashboard.demo.DashboardReleaseMapper.ReleaseRow;
import gov.district.dashboard.demo.DemoPlaybackService.Component;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Service
@Profile("demo")
public class DashboardReleaseService {

    private static final TypeReference<List<Component>> COMPONENTS = new TypeReference<>() {};
    private final DashboardReleaseMapper releases;
    private final DashboardDraftMapper drafts;
    private final ObjectMapper json;

    DashboardReleaseService(DashboardReleaseMapper releases, DashboardDraftMapper drafts, ObjectMapper json) {
        this.releases = releases;
        this.drafts = drafts;
        this.json = json;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Workspace read(String projectId) {
        DemoPlaybackService.draftTemplate(projectId);
        return workspace(projectId);
    }

    public List<Component> snapshot(String projectId, int revision) {
        DemoPlaybackService.draftTemplate(projectId);
        return decode(release(projectId, revision).componentsJson());
    }

    @Transactional
    public Workspace submit(String projectId, int revision, String actor) {
        var template = DemoPlaybackService.draftTemplate(projectId);
        Integer saved = releases.lockDraft(projectId);
        if (saved == null || saved != revision) {
            throw conflict();
        }
        if (releases.find(projectId, revision) != null) {
            return workspace(projectId);
        }
        if (releases.list(projectId).stream().anyMatch(row -> row.reviewStatus().equals("PENDING"))) {
            throw conflict();
        }
        List<Component> layout = drafts.find(projectId).stream()
                .filter(row -> row.componentId() != null)
                .map(DashboardDraftMapper.DraftRow::component)
                .toList();
        if (layout.isEmpty()) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        List<Component> validated = DashboardDraftService.validatedLayout(template, layout);
        releases.insertRelease(projectId, revision, actor, Instant.now(), json.writeValueAsString(validated));
        return workspace(projectId);
    }

    @Transactional
    public Workspace review(String projectId, int revision, long serial, Decision decision, String reason, String actor) {
        var template = DemoPlaybackService.draftTemplate(projectId);
        if (releases.lockDraft(projectId) == null) {
            throw new ApiFailure(ApiCode.NOT_FOUND);
        }
        LiveRow live = releases.findLive(projectId);
        if (serial != (live == null ? 0 : live.serial())) {
            throw conflict();
        }
        String note = reason == null ? "" : reason.strip();
        if (note.codePointCount(0, note.length()) > 200 || (decision != Decision.APPROVE && note.isEmpty())) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        Instant now = Instant.now();
        if (decision == Decision.ROLLBACK) {
            if (revision > 0) {
                ReleaseRow target = release(projectId, revision);
                if (!target.reviewStatus().equals("APPROVED")) {
                    throw conflict();
                }
                DashboardDraftService.validatedLayout(template, decode(target.componentsJson()));
            }
            activate(projectId, revision == 0 ? null : revision, live, actor, now, note);
        } else {
            ReleaseRow target = release(projectId, revision);
            if (target.submittedBy().equals(actor)) {
                throw new ApiFailure(ApiCode.ACCESS_DENIED);
            }
            if (decision == Decision.APPROVE) {
                DashboardDraftService.validatedLayout(template, decode(target.componentsJson()));
            }
            String status = decision == Decision.APPROVE ? "APPROVED" : "RETURNED";
            if (releases.review(projectId, revision, status, actor, now, note) != 1) {
                throw conflict();
            }
            if (decision == Decision.APPROVE) {
                activate(projectId, revision, live, actor, now, note);
            }
        }
        return workspace(projectId);
    }

    Active active(String projectId) {
        var row = releases.findLiveRelease(projectId);
        if (row == null) {
            return new Active(0, null);
        }
        return new Active(row.serial(), row.componentsJson() == null ? null : decode(row.componentsJson()));
    }

    private List<Component> decode(String value) {
        return List.copyOf(json.readValue(value, COMPONENTS));
    }

    private ReleaseRow release(String projectId, int revision) {
        ReleaseRow result = releases.find(projectId, revision);
        if (result == null) {
            throw new ApiFailure(ApiCode.NOT_FOUND);
        }
        return result;
    }

    private Workspace workspace(String projectId) {
        LiveRow live = releases.findLive(projectId);
        var history = releases.list(projectId).stream()
                .map(row -> new Submission(row.revision(), row.reviewStatus(), row.submittedBy(), row.submittedAt(),
                        row.reviewedBy(), row.reviewedAt(), row.reviewNote())).toList();
        return new Workspace(live == null ? 0 : live.serial(), live == null ? null : live.revision(), history);
    }

    private void activate(String projectId, Integer revision, LiveRow live, String actor, Instant now, String note) {
        if (Objects.equals(revision, live == null ? null : live.revision())) {
            return;
        }
        long next = live == null ? 1 : live.serial() + 1;
        if (live == null) {
            releases.insertLive(projectId, revision, next, actor, now);
        } else if (releases.updateLive(projectId, revision, live.serial(), actor, now) != 1) {
            throw conflict();
        }
        releases.insertActivation(projectId, revision, next, actor, now, note);
    }

    private static ApiFailure conflict() {
        return new ApiFailure(ApiCode.VERSION_CONFLICT);
    }

    public enum Decision { APPROVE, RETURN, ROLLBACK }

    record Active(long serial, List<Component> components) {}

    public record Workspace(long serial, Integer activeRevision, List<Submission> releases) {}

    public record Submission(int revision, String status, String submittedBy, Instant submittedAt,
                             String reviewedBy, Instant reviewedAt, String reviewNote) {}
}
