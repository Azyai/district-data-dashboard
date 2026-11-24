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
                            ranking("category-volume", "事件类型分布", "件", "network"))),
            "city-snapshot-1", "DISTRICT_VIEWER");

    private static final Project SERVICES = new Project(
            new Manifest(1, "public-services", "services-release-1", "政务服务",
                    "查看办件量、线上办理与服务质量。", "services", CANVAS,
                    List.of(
                            kpi("received-cases", "受理办件", "件", 48),
                            kpi("online-rate", "网办率", "%", 664),
                            kpi("satisfaction-rate", "满意度", "%", 1280),
                            trend("service-trend", "近 7 日接件量", "件"),
                            ranking("service-category-volume", "热门事项类型", "件", "ring"))),
            "services-snapshot-1", "SERVICE_VIEWER");

    private static final List<Project> PUBLIC_TOPICS = List.of(
            topic("population", "人口专题", "查看常住人口规模、年龄结构与近期变化。",
                    topicKpi("resident-total", "常住人口", "人", 180),
                    topicKpi("working-age-rate", "劳动年龄人口占比", "%", 426),
                    topicKpi("older-rate", "65 岁及以上人口占比", "%", 672),
                    topicChart("age-structure", "年龄结构", "人", "network", 550, 180, 820, 720),
                    topicTrend("population-trend", "近 6 个月常住人口", "人", "line"),
                    topicChart("household-structure", "家庭户规模分布", "户", "ring", 1442, 545, 430, 355)),
            topic("hotline", "接诉即办", "查看诉求受理、办理进度与高频事项。",
                    topicKpi("requests-total", "诉求受理", "件", 180),
                    topicKpi("resolved-rate", "诉求办结率", "%", 426),
                    topicKpi("pending-requests", "待办理诉求", "件", 672),
                    topicChart("requests-by-type", "高频诉求", "件", "network", 550, 180, 820, 720),
                    topicTrend("requests-trend", "近 7 日受理量", "件", "bar"),
                    topicChart("requests-status", "办理进度", "件", "ring", 1442, 545, 430, 355)),
            topic("water", "水务专题", "查看供水情况、监测达标情况与供水结构。",
                    topicKpi("daily-water", "日供水量", "万立方米", 180),
                    topicKpi("water-compliance", "出厂水检测达标率", "%", 426),
                    topicKpi("active-stations", "在线监测站", "座", 672),
                    topicChart("water-network-quality", "监测点达标率", "%", "radar", 550, 180, 820, 720),
                    topicTrend("water-trend", "近 7 日供水量", "万立方米", "line"),
                    topicChart("water-mix", "供水用途分布", "万立方米", "bar", 1442, 545, 430, 355)));
    private static final List<Project> PROJECTS = java.util.stream.Stream.concat(
            java.util.stream.Stream.of(CITY, SERVICES), PUBLIC_TOPICS.stream()).toList();

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

    public Manifest publicManifest(String projectId) {
        return publicTopic(projectId).manifest();
    }

    public BatchQueryResult publicSnapshot(String projectId, String releaseId) {
        Project project = publicTopic(projectId);
        return queryRelease(project, releaseId, project.manifest().components().stream().map(Component::id).toList());
    }

    public BatchQueryResult query(CurrentIdentity viewer, String projectId, String releaseId,
                                  List<String> componentIds) {
        return queryRelease(visibleProject(viewer, projectId), releaseId, componentIds);
    }

    private BatchQueryResult queryRelease(Project project, String releaseId, List<String> componentIds) {
        if (!project.manifest().releaseId().equals(releaseId)) {
            throw new ApiFailure(ApiCode.RELEASE_CONFLICT);
        }
        return query(project, componentIds);
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

    private static Project project(String projectId) {
        return findProject(PROJECTS, projectId);
    }

    private static Project publicTopic(String projectId) {
        return findProject(PUBLIC_TOPICS, projectId);
    }

    private static Project findProject(List<Project> projects, String projectId) {
        return projects.stream()
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

    private static Component ranking(String metricId, String title, String unit, String chartStyle) {
        return new Component(metricId, title, "ranking", metricId, unit, new Geometry(1184, 220, 688, 740, 1), chartStyle);
    }

    private static Component component(String metricId, String title, String type, String unit, Geometry geometry) {
        return new Component(metricId, title, type, metricId, unit, geometry);
    }

    private static Project topic(String id, String title, String description, Component... components) {
        return new Project(new Manifest(1, id, id + "-release-1", title, description, id, CANVAS,
                List.of(components)), id + "-snapshot-1", "DISTRICT_VIEWER");
    }

    private static Component topicKpi(String id, String title, String unit, int y) {
        return component(id, title, "kpi", unit, new Geometry(48, y, 430, 170, 2));
    }

    private static Component topicTrend(String id, String title, String unit, String style) {
        return new Component(id, title, "trend", id, unit, new Geometry(1442, 180, 430, 315, 2), style);
    }

    private static Component topicChart(String id, String title, String unit, String style,
                                        int x, int y, int width, int height) {
        return new Component(id, title, "ranking", id, unit, new Geometry(x, y, width, height, 2), style);
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

    public record Component(String id, String title, String type, String metricId, String unit, Geometry geometry,
                            @JsonInclude(JsonInclude.Include.NON_NULL) String chartStyle) {
        public Component(String id, String title, String type, String metricId, String unit, Geometry geometry) {
            this(id, title, type, metricId, unit, geometry, null);
        }
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
