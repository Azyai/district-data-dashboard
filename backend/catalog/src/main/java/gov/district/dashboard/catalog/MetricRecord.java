package gov.district.dashboard.catalog;

import java.time.Instant;

public record MetricRecord(String id, long revision, MetricInput draft, Published published) {

    public record Published(MetricInput definition, long version, Instant publishedAt) {
    }
}
