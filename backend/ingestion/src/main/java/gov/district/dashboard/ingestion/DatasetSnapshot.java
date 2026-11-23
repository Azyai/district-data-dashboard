package gov.district.dashboard.ingestion;

import java.time.Instant;
import java.util.List;

public record DatasetSnapshot(String sourceId, String sourceName, String batchId, Instant syncedAt,
                              List<Observation> observations) {

    public DatasetSnapshot {
        observations = List.copyOf(observations);
    }
}
