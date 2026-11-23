package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.IngestionStore.SourceEntry;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public final class DatasetQuery {

    private static final int REGION_BATCH_SIZE = 128;
    private static final int WINDOW_DAYS = 7;
    private static final LocalDate MIN_OBSERVATION_DATE = LocalDate.of(1000, 1, 1);
    private final IngestionStore store;

    DatasetQuery(IngestionStore store) {
        this.store = store;
    }

    public Optional<Batch> latest(String sourceId) {
        return store.find(sourceId).map(SourceEntry::response)
                .filter(source -> source.lastSuccessBatchId() != null)
                .map(source -> new Batch(source.id(), source.name(), source.lastSuccessBatchId(), source.lastSuccessfulAt()));
    }

    public List<Coverage> coverage(Batch batch, String measure) {
        return store.coverage(batch.batchId(), measure);
    }

    public List<Observation> latestWindow(Batch batch, String measure, List<String> regionIds, LocalDate latestDay) {
        LocalDate start = latestDay.minusDays(WINDOW_DAYS - 1L);
        if (start.isBefore(MIN_OBSERVATION_DATE)) {
            start = MIN_OBSERVATION_DATE;
        }

        var observations = new ArrayList<Observation>();
        for (int first = 0; first < regionIds.size(); first += REGION_BATCH_SIZE) {
            List<String> portion = regionIds.subList(first, Math.min(first + REGION_BATCH_SIZE, regionIds.size()));
            observations.addAll(store.observationWindow(batch.batchId(), measure, portion, start, latestDay));
        }
        return observations;
    }

    public record Batch(String sourceId, String sourceName, String batchId, Instant syncedAt) {
    }

    public record Coverage(String regionId, LocalDate latestDay, boolean invalidRate) {
    }
}
