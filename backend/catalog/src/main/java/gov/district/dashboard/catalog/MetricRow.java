package gov.district.dashboard.catalog;

import gov.district.dashboard.catalog.MetricInput.Aggregation;
import gov.district.dashboard.catalog.MetricRecord.Published;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/** Projection of a draft and its current immutable release. */
record MetricRow(String metricId, long revision, String label, String unit, String sourceId, String measure,
                 Aggregation aggregation, String description, Long publishedVersion, String publishedLabel,
                 String publishedUnit, String publishedSourceId, String publishedMeasure,
                 Aggregation publishedAggregation, String publishedDescription, LocalDateTime publishedAt) {

    MetricRecord toRecord() {
        MetricInput draft = new MetricInput(metricId, label, unit, sourceId, measure, aggregation, description);
        Published published = publishedVersion == null ? null : new Published(new MetricInput(metricId,
                publishedLabel, publishedUnit, publishedSourceId, publishedMeasure, publishedAggregation,
                publishedDescription), publishedVersion, publishedAt.toInstant(ZoneOffset.UTC));
        return new MetricRecord(metricId, revision, draft, published);
    }
}
