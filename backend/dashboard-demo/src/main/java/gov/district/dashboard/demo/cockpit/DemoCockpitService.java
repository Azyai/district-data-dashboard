package gov.district.dashboard.demo.cockpit;

import com.fasterxml.jackson.annotation.JsonInclude;
import gov.district.dashboard.catalog.MetricQuery;
import gov.district.dashboard.catalog.MetricQuery.Evidence;
import gov.district.dashboard.catalog.MetricQuery.Reading;
import gov.district.dashboard.catalog.MetricQuery.Status;
import gov.district.dashboard.demo.cockpit.MentougouAreaCatalog.Area;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.function.ToDoubleFunction;
import java.util.stream.IntStream;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("demo")
public final class DemoCockpitService {

    private static final Instant CAPTURED_AT = Instant.parse("2026-11-23T04:00:00Z");
    private static final int DAYS = 7;
    private static final LocalDate FIRST_DAY = CAPTURED_AT.atZone(ZoneId.of("Asia/Shanghai"))
            .toLocalDate().minusDays(DAYS - 1);
    private static final List<String> CATEGORIES = List.of("市容环境", "道路交通", "公共设施", "社区治理", "其他");
    private static final List<Integer> CATEGORY_PERCENTAGES = List.of(32, 23, 19, 16, 10);
    private static final String GOVERNANCE_EVENTS = "governance-events";
    private static final List<BaselineMetric> BASELINE = List.of(
            new BaselineMetric(GOVERNANCE_EVENTS, "治理事件受理", "件", DailyTotals::events),
            new BaselineMetric("completion-rate", "事件办结率", "%",
                    total -> percentage(total.closedEvents(), total.events())),
            new BaselineMetric("service-cases", "政务服务办件", "件", DailyTotals::serviceCases),
            new BaselineMetric("active-alerts", "待处置预警", "条", DailyTotals::activeAlerts),
            new BaselineMetric("air-quality-rate", "优良空气监测占比", "%",
                    total -> percentage(total.goodAirSamples(), total.airSamples())),
            new BaselineMetric("road-traffic", "道路通行量", "车次", DailyTotals::roadTraffic),
            new BaselineMetric("tourism-visits", "文旅接待", "人次", DailyTotals::tourismVisits),
            new BaselineMetric("active-projects", "在建重点项目", "个", DailyTotals::activeProjects));

    private final MetricQuery metrics;

    DemoCockpitService(MetricQuery metrics) {
        this.metrics = metrics;
    }

    public List<Location> locations() {
        return MentougouAreaCatalog.allPaths().stream().map(path -> {
            Area area = path.getLast();
            String parentId = path.size() == 1 ? null : path.get(path.size() - 2).id();
            return new Location(area.id(), area.name(), area.level(), parentId);
        }).toList();
    }

    public AreaSnapshot snapshot(String areaId) {
        List<Area> path = MentougouAreaCatalog.path(areaId);
        if (path.isEmpty()) {
            throw new ApiFailure(ApiCode.NOT_FOUND);
        }
        Area area = path.getLast();
        List<Breadcrumb> breadcrumbs = path.stream()
                .map(item -> new Breadcrumb(item.id(), item.name(), item.level()))
                .toList();
        List<DailyTotals> week = IntStream.range(0, DAYS).mapToObj(day -> totals(area, day)).toList();
        List<Reading> published = metrics.readArea(areaId);
        var readings = new LinkedHashMap<String, Metric>();
        BASELINE.forEach(definition -> readings.put(definition.id(), definition.read(week)));
        published.stream().map(DemoCockpitService::metric).forEach(metric -> readings.put(metric.id(), metric));

        var governance = published.stream().filter(row -> row.definition().id().equals(GOVERNANCE_EVENTS)).findFirst();
        List<Point> trend = governance
                .map(reading -> reading.points().stream()
                        .map(point -> new Point(point.date().toString(), point.value())).toList())
                .orElseGet(() -> IntStream.range(0, DAYS).mapToObj(day -> new Point(
                        FIRST_DAY.plusDays(day).toString(), BigDecimal.valueOf(week.get(day).events()))).toList());
        List<Point> topics = governance.isPresent() ? List.of() : distribution(week.getLast().events());
        Instant updatedAt = published.stream().filter(reading -> reading.status() == Status.READY)
                .map(reading -> reading.evidence().updatedAt())
                .reduce(CAPTURED_AT, (left, right) -> left.isAfter(right) ? left : right);

        return new AreaSnapshot(area.id(), area.name(), area.level(), breadcrumbs,
                area.children().stream().map(DemoCockpitService::childMarker).toList(),
                updatedAt, "SIMULATED", List.copyOf(readings.values()), trend, topics, signals());
    }

    private static Metric metric(Reading reading) {
        var definition = reading.definition();
        return new Metric(definition.id(), definition.label(), reading.value(), definition.unit(), reading.delta(),
                reading.points().stream().map(MetricQuery.DailyPoint::value).toList(),
                reading.status(), reading.evidence());
    }

    private static ChildArea childMarker(Area area) {
        return new ChildArea(area.id(), area.name(), area.level(), area.x(), area.z());
    }

    private record BaselineMetric(String id, String label, String unit, ToDoubleFunction<DailyTotals> measure) {
        Metric read(List<DailyTotals> week) {
            List<BigDecimal> series = week.stream().mapToDouble(measure).mapToObj(BigDecimal::valueOf).toList();
            BigDecimal latest = series.getLast();
            BigDecimal previous = series.get(series.size() - 2);
            return new Metric(id, label, latest, unit, latest.subtract(previous), series, Status.READY, null);
        }
    }

    private static double percentage(int numerator, int denominator) {
        return roundTenth(numerator * 100.0 / denominator);
    }

    private static double roundTenth(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private static DailyTotals totals(Area area, int day) {
        if (!area.children().isEmpty()) {
            return area.children().stream().map(child -> totals(child, day)).reduce(DailyTotals.ZERO, DailyTotals::plus);
        }

        int scenario = Math.floorMod(area.id().hashCode(), 31);
        int activity = area.activity();
        int events = activity + Math.floorMod(scenario + day * 3, 13);
        int closed = events - Math.floorMod(scenario + day, 4);
        int serviceCases = activity * 2 + Math.floorMod(scenario * 2 + day * 5, 21);
        int alerts = Math.floorMod(scenario + day, 5);
        int airSamples = 22 + activity / 10 + Math.floorMod(scenario + day, 5);
        int goodAir = airSamples - Math.floorMod(scenario + day * 3, 4);
        int roadTraffic = activity * 43 + 11 * Math.floorMod(scenario * 3 + day * 9, 37);
        int tourismVisits = activity * 5 + 4 * Math.floorMod(scenario * 5 + day * 7, 29);
        int activeProjects = 1 + activity / 35 + Math.floorMod(scenario + day / 3, 2);
        return new DailyTotals(events, closed, serviceCases, alerts, airSamples, goodAir,
                roadTraffic, tourismVisits, activeProjects);
    }

    private static List<Point> distribution(int events) {
        var portions = new ArrayList<Point>();
        int assigned = 0;
        for (int index = 0; index < CATEGORIES.size() - 1; index++) {
            int value = events * CATEGORY_PERCENTAGES.get(index) / 100;
            assigned += value;
            portions.add(new Point(CATEGORIES.get(index), BigDecimal.valueOf(value)));
        }
        portions.add(new Point(CATEGORIES.getLast(), BigDecimal.valueOf(events - assigned)));
        return List.copyOf(portions);
    }

    private static List<Signal> signals() {
        return List.of(
                new Signal("demo-inspection", "模拟 · 设施巡检待复核",
                        "用于演示待关注信号，未关联真实巡检记录。", "attention",
                        CAPTURED_AT.minus(18, ChronoUnit.MINUTES)),
                new Signal("demo-refresh", "模拟 · 指标快照已同步",
                        "展示合成数据的快照状态。", "normal", CAPTURED_AT));
    }

    private record DailyTotals(int events, int closedEvents, int serviceCases, int activeAlerts,
                               int airSamples, int goodAirSamples, int roadTraffic, int tourismVisits,
                               int activeProjects) {

        private static final DailyTotals ZERO = new DailyTotals(0, 0, 0, 0, 0, 0, 0, 0, 0);

        DailyTotals plus(DailyTotals next) {
            return new DailyTotals(events + next.events, closedEvents + next.closedEvents,
                    serviceCases + next.serviceCases, activeAlerts + next.activeAlerts,
                    airSamples + next.airSamples, goodAirSamples + next.goodAirSamples,
                    roadTraffic + next.roadTraffic, tourismVisits + next.tourismVisits,
                    activeProjects + next.activeProjects);
        }
    }

    public record AreaSnapshot(String id, String name, String level, List<Breadcrumb> breadcrumbs,
                               List<ChildArea> children, Instant updatedAt, String quality, List<Metric> metrics,
                               List<Point> trend, List<Point> distribution, List<Signal> signals) {
    }

    public record Location(String id, String name, String level,
                           @JsonInclude(JsonInclude.Include.ALWAYS) String parentId) {
    }

    public record Breadcrumb(String id, String name, String level) {
    }

    public record ChildArea(String id, String name, String level, double x, double z) {
    }

    public record Metric(String id, String label, BigDecimal value, String unit, BigDecimal delta,
                         List<BigDecimal> series, Status status, @JsonInclude(JsonInclude.Include.NON_NULL) Evidence evidence) {
    }

    public record Point(String label, BigDecimal value) {
    }

    public record Signal(String id, String title, String detail, String status, Instant time) {
    }
}
