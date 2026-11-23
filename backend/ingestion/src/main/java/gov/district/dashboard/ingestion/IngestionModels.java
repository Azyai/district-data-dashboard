package gov.district.dashboard.ingestion;

import java.time.Instant;
import java.util.List;

final class IngestionModels {

    private IngestionModels() {
    }

    enum SourceType {
        HTTPS_JSON, MYSQL_VIEW, CSV
    }

    enum RunStatus {
        RUNNING, SUCCEEDED, FAILED, REJECTED
    }

    enum Trigger {
        MANUAL, SCHEDULED, RETRY
    }

    record SourceInput(String id, String name, SourceType type, SourceConfig config, FieldMapping mapping,
                       Integer refreshMinutes) {
    }

    record SourceConfig(String endpoint, String connectionRef, String viewRef, String assetRef) {
    }

    record FieldMapping(String region, String date, String measure, String value, String denominator) {
    }

    record SourceResponse(String id, String name, SourceType type, SourceConfig config, FieldMapping mapping,
                          int refreshMinutes, int version, Instant createdAt, Instant updatedAt,
                          String lastSuccessBatchId, Instant lastSuccessfulAt, RunStatus lastSyncStatus) {
    }

    record SyncRequest(String retryOf) {
    }

    record SyncRun(String id, String sourceId, RunStatus status, Trigger trigger, String retryOf, String batchId,
                   Instant startedAt, Instant finishedAt, int rowsRead, int rowsAccepted, int rowsRejected,
                   String message) {
    }

    record Asset(String id, String fileName, long sizeBytes, Instant createdAt) {
    }

    record ConnectionTest(String status, String message, List<String> fields, List<Observation> preview,
                          int totalRows, int rejectedRows) {
    }

    record DatasetSummary(String batchId, Instant syncedAt, int rowCount, List<String> measures) {
    }

    record SourceOptions(List<HttpsOption> httpsEndpoints, List<MysqlOption> mysqlConnections) {
    }

    record HttpsOption(String label, String endpoint) {
    }

    record MysqlOption(String id, String label, List<ViewOption> views) {
    }

    record ViewOption(String id, String label) {
    }
}
