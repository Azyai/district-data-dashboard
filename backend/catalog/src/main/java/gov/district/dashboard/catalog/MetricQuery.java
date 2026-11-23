package gov.district.dashboard.catalog;

import gov.district.dashboard.catalog.MetricInput.Aggregation;
import gov.district.dashboard.catalog.MetricRecord.Published;
import gov.district.dashboard.ingestion.DatasetQuery;
import gov.district.dashboard.ingestion.DatasetQuery.Batch;
import gov.district.dashboard.ingestion.DatasetQuery.Coverage;
import gov.district.dashboard.ingestion.Observation;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("demo")
public class MetricQuery {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final MetricMapper mapper;
    private final DatasetQuery datasets;
    private final RegionDirectory regions;

    MetricQuery(MetricMapper mapper, DatasetQuery datasets, RegionDirectory regions) {
        this.mapper = mapper;
        this.datasets = datasets;
        this.regions = regions;
    }

    void requireAvailable(MetricInput definition) {
        List<Coverage> coverage = datasets.latest(definition.sourceId())
                .map(batch -> datasets.coverage(batch, definition.measure()))
                .orElseGet(List::of);
        if (!accepted(definition, coverage)) {
            throw new ApiFailure(ApiCode.DATASET_REQUIRED);
        }
    }

    @Transactional(readOnly = true)
    public List<Reading> readArea(String areaId) {
        if (regions.path(areaId).isEmpty()) {
            throw new ApiFailure(ApiCode.NOT_FOUND);
        }
        Map<String, Optional<Batch>> batches = new HashMap<>();
        Map<BatchMeasure, List<Coverage>> coverageByMeasure = new HashMap<>();
        Map<BatchMeasure, List<Observation>> windows = new HashMap<>();
        List<Reading> readings = new ArrayList<>();
        for (MetricRow row : mapper.findPublished()) {
            Published published = row.toRecord().published();
            MetricInput definition = published.definition();
            Optional<Batch> batch = batches.computeIfAbsent(definition.sourceId(), datasets::latest);
            if (batch.isEmpty()) {
                readings.add(Reading.noData(definition, null));
                continue;
            }
            Batch dataset = batch.orElseThrow();
            String measure = definition.measure();
            BatchMeasure key = new BatchMeasure(dataset.batchId(), measure);
            List<Coverage> coverage = coverageByMeasure.computeIfAbsent(key, ignored -> datasets.coverage(dataset, measure));
            List<Observation> observations = accepted(definition, coverage)
                    ? windows.computeIfAbsent(key, ignored -> latestWindow(dataset, measure, coverage, areaId))
                    : List.of();
            readings.add(read(published, dataset, observations));
        }
        return List.copyOf(readings);
    }

    private List<Observation> latestWindow(Batch batch, String measure, List<Coverage> coverage, String areaId) {
        List<Coverage> scoped = coverage.stream().filter(item -> regions.path(item.regionId()).contains(areaId)).toList();
        return scoped.stream().map(Coverage::latestDay).max(Comparator.naturalOrder())
                .map(latest -> datasets.latestWindow(batch, measure, scoped.stream().map(Coverage::regionId).toList(), latest))
                .orElseGet(List::of);
    }

    private Reading read(Published published, Batch dataset, List<Observation> observations) {
        MetricInput definition = published.definition();
        TreeMap<LocalDate, Map<String, Totals>> dates = new TreeMap<>();
        for (Observation observation : observations) {
            dates.computeIfAbsent(observation.observedOn(), ignored -> new HashMap<>())
                    .merge(observation.regionId(), Totals.of(observation), Totals::plus);
        }
        if (dates.isEmpty()) {
            return Reading.noData(definition, evidence(published, dataset, null));
        }

        LocalDate latestDay = dates.lastKey();
        List<DailyPoint> points = dates.entrySet().stream()
                .map(entry -> new DailyPoint(entry.getKey(), aggregate(entry.getValue(), definition.aggregation())))
                .toList();
        BigDecimal value = points.getLast().value();
        BigDecimal delta = points.stream()
                .filter(point -> point.date().equals(latestDay.minusDays(1)))
                .findFirst()
                .map(previous -> value.subtract(previous.value()))
                .orElse(null);
        return new Reading(definition, value, delta, points, Status.READY, evidence(published, dataset, latestDay));
    }

    private boolean accepted(MetricInput definition, List<Coverage> coverage) {
        return !coverage.isEmpty() && coverage.stream().allMatch(item ->
                !regions.path(item.regionId()).isEmpty()
                        && (definition.aggregation() != Aggregation.RATE || !item.invalidRate()));
    }

    private BigDecimal aggregate(Map<String, Totals> readings, Aggregation aggregation) {
        Totals total = Totals.ZERO;
        for (var reading : readings.entrySet()) {
            List<String> path = regions.path(reading.getKey());
            // A same-day direct reading covers its branch, so avoid adding its descendants a second time.
            boolean coveredByParent = path.subList(0, path.size() - 1).stream().anyMatch(readings::containsKey);
            if (!coveredByParent) {
                total = total.plus(reading.getValue());
            }
        }
        return aggregation == Aggregation.RATE
                ? total.numerator().multiply(HUNDRED).divide(total.denominator(), 2, RoundingMode.HALF_UP)
                : total.numerator();
    }

    private static Evidence evidence(Published published, Batch dataset, LocalDate observedOn) {
        MetricInput definition = published.definition();
        return new Evidence(dataset.sourceId(), dataset.sourceName(), definition.measure(), dataset.batchId(),
                published.version(), observedOn, dataset.syncedAt(), definition.description());
    }

    private record BatchMeasure(String batchId, String measure) {
    }

    private record Totals(BigDecimal numerator, BigDecimal denominator) {

        private static final Totals ZERO = new Totals(BigDecimal.ZERO, BigDecimal.ZERO);

        static Totals of(Observation observation) {
            return new Totals(observation.value(),
                    observation.denominator() == null ? BigDecimal.ZERO : observation.denominator());
        }

        Totals plus(Totals other) {
            return new Totals(numerator.add(other.numerator), denominator.add(other.denominator));
        }
    }

    public enum Status {
        READY, NO_DATA
    }

    public record DailyPoint(LocalDate date, BigDecimal value) {
    }

    public record Evidence(String sourceId, String sourceName, String measure, String batchId, long version,
                           LocalDate observedOn, Instant updatedAt, String description) {
    }

    public record Reading(MetricInput definition, BigDecimal value, BigDecimal delta, List<DailyPoint> points,
                          Status status, Evidence evidence) {

        static Reading noData(MetricInput definition, Evidence evidence) {
            return new Reading(definition, null, null, List.of(), Status.NO_DATA, evidence);
        }
    }
}
