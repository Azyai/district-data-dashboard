package gov.district.dashboard.demo;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import gov.district.dashboard.demo.DemoIdentityService.CurrentIdentity;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("demo")
public final class DemoPlaybackService {

    private static final Canvas CANVAS = new Canvas(1920, 1080);
    private static final Instant SYNTHETIC_CAPTURE = Instant.parse("2026-11-23T04:00:00Z");

    private static final Project CITY = new Project(
            new Manifest(1, "city-operations", "city-release-1", "城市运行",
                    "查看事件流转、重点预警与分类分布。", "city", CANVAS,
                    List.of(
                            kpi("accepted-events", "受理事件", "件", 48),
                            kpi("completion-rate", "办结率", "%", 664),
                            kpi("active-alerts", "待处置预警", "条", 1280),
                            trend("event-trend", "近 7 日事件受理量", "件"),
                            ranking("category-volume", "事件类型分布", "件"))),
            "city-snapshot-1", "DISTRICT_VIEWER");

    private static final Project SERVICES = new Project(
            new Manifest(1, "public-services", "services-release-1", "政务服务",
                    "查看办件量、线上办理与服务质量。", "services", CANVAS,
                    List.of(
                            kpi("received-cases", "受理办件", "件", 48),
                            kpi("online-rate", "网办率", "%", 664),
                            kpi("satisfaction-rate", "满意度", "%", 1280),
                            trend("service-trend", "近 7 日接件量", "件"),
                            ranking("service-category-volume", "热门事项类型", "件"))),
            "services-snapshot-1", "SERVICE_VIEWER");

    private static final List<Project> PROJECTS = List.of(CITY, SERVICES);

    private final DemoObservationMapper observations;

    DemoPlaybackService(DemoObservationMapper observations) {
        this.observations = observations;
    }

    public List<ProjectSummary> recommendations(CurrentIdentity viewer) {
        return PROJECTS.stream()
                .filter(project -> canView(viewer, project))
                .map(Project::manifest)
                .map(manifest -> new ProjectSummary(manifest.projectId(), manifest.title(), manifest.description(),
                        manifest.theme(), manifest.projectId().equals(viewer.defaultProjectId())
                                ? "PERSONAL_DEFAULT" : "AUTHORIZED_PROJECT"))
                .toList();
    }

    public Manifest manifest(CurrentIdentity viewer, String projectId) {
        return visibleProject(viewer, projectId).manifest();
    }

    public BatchQueryResult query(CurrentIdentity viewer, String projectId, String releaseId,
                                  List<String> componentIds) {
        Project project = visibleProject(viewer, projectId);
        if (!project.manifest().releaseId().equals(releaseId)) {
            throw new ApiFailure(ApiCode.RELEASE_CONFLICT);
        }
        return query(project, componentIds);
    }

    Manifest draftTemplate(String projectId) {
        return project(projectId).manifest();
    }

    BatchQueryResult draftSnapshot(String projectId) {
        Project project = project(projectId);
        return query(project, project.manifest().components().stream().map(Component::id).toList());
    }

    private BatchQueryResult query(Project project, List<String> componentIds) {
        Map<String, Component> components = project.manifest().components().stream()
                .collect(Collectors.toMap(Component::id, Function.identity()));
        if (new HashSet<>(componentIds).size() != componentIds.size()
                || !components.keySet().containsAll(componentIds)) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }

        List<String> metricIds = componentIds.stream().map(components::get).map(Component::metricId).distinct().toList();
        List<DemoObservation> rows = observations.selectList(Wrappers.<DemoObservation>query()
                .eq("snapshot_id", project.snapshotId())
                .in("metric_id", metricIds)
                .orderByAsc("point_no"));
        Map<String, List<DemoObservation>> byMetric = rows.stream()
                .collect(Collectors.groupingBy(DemoObservation::metricId));

        List<ComponentResult> results = componentIds.stream()
                .map(components::get)
                .map(component -> renderResult(component, byMetric.get(component.metricId())))
                .toList();

        return new BatchQueryResult(project.manifest().projectId(), project.manifest().releaseId(),
                project.snapshotId(), SYNTHETIC_CAPTURE,
                "SIMULATED", results);
    }

    private Project visibleProject(CurrentIdentity viewer, String projectId) {
        Project project = project(projectId);
        if (!canView(viewer, project)) {
            throw new ApiFailure(ApiCode.PROJECT_NOT_FOUND);
        }
        return project;
    }

    private Project project(String projectId) {
        return PROJECTS.stream()
                .filter(project -> project.manifest().projectId().equals(projectId))
                .findFirst()
                .orElseThrow(() -> new ApiFailure(ApiCode.PROJECT_NOT_FOUND));
    }

    private boolean canView(CurrentIdentity viewer, Project project) {
        return viewer.roles().contains("DISTRICT_VIEWER") || viewer.roles().contains(project.requiredRole());
    }

    private ComponentResult renderResult(Component component, List<DemoObservation> values) {
        if (values == null || values.isEmpty()) {
            throw new ApiFailure(ApiCode.INTERNAL_ERROR);
        }
        if (component.type().equals("kpi")) {
            return new ComponentResult(component.id(), component.metricId(), component.unit(),
                    values.getFirst().metricValue(), null);
        }
        List<DataPoint> points = values.stream().map(row -> new DataPoint(row.pointLabel(), row.metricValue())).toList();
        return new ComponentResult(component.id(), component.metricId(), component.unit(), null, points);
    }

    private static Component kpi(String metricId, String title, String unit, int x) {
        return component(metricId, title, "kpi", unit, new Geometry(x, 40, 592, 148, 1));
    }

    private static Component trend(String metricId, String title, String unit) {
        return component(metricId, title, "trend", unit, new Geometry(48, 220, 1112, 740, 1));
    }

    private static Component ranking(String metricId, String title, String unit) {
        return component(metricId, title, "ranking", unit, new Geometry(1184, 220, 688, 740, 1));
    }

    private static Component component(String metricId, String title, String type, String unit, Geometry geometry) {
        return new Component(metricId, title, type, metricId, unit, geometry);
    }

    private record Project(Manifest manifest, String snapshotId, String requiredRole) {
    }

    public record ProjectSummary(String id, String name, String description, String theme, String reason) {
    }

    public record Manifest(int schemaVersion, String projectId, String releaseId, String title, String description,
                           String theme, Canvas canvas, List<Component> components) {
    }

    public record Canvas(int width, int height) {
    }

    public record Component(String id, String title, String type, String metricId, String unit, Geometry geometry) {
    }

    public record Geometry(int x, int y, int width, int height, int z) {
    }

    public record BatchQueryResult(String projectId, String releaseId, String snapshotId, Instant updatedAt,
                                   String quality, List<ComponentResult> results) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ComponentResult(String componentId, String metricId, String unit,
                                  BigDecimal value, List<DataPoint> points) {
    }

    public record DataPoint(String label, BigDecimal value) {
    }
}
