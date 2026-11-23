package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.DatasetQuery.Coverage;
import gov.district.dashboard.ingestion.IngestionModels.Asset;
import gov.district.dashboard.ingestion.IngestionModels.DatasetSummary;
import gov.district.dashboard.ingestion.IngestionModels.RunStatus;
import gov.district.dashboard.ingestion.IngestionModels.SourceInput;
import gov.district.dashboard.ingestion.IngestionModels.SourceResponse;
import gov.district.dashboard.ingestion.IngestionModels.SyncRun;
import gov.district.dashboard.ingestion.IngestionModels.Trigger;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

@Repository
class IngestionStore {

    private static final String SOURCE = """
            SELECT s.id, s.current_version, s.created_at, s.updated_at, s.next_due_at, s.active_run_id,
                   s.lease_until, s.last_success_batch_id, s.consecutive_failures, r.definition,
                   last_run.status AS last_status, b.synced_at AS last_synced_at
            FROM src_source s
            JOIN src_revision r ON r.source_id = s.id AND r.version_no = s.current_version
            LEFT JOIN src_run last_run ON last_run.id = s.last_run_id
            LEFT JOIN src_batch b ON b.id = s.last_success_batch_id
            """;
    private static final String RUN = """
            SELECT id, source_id, status, trigger_type, retry_of, batch_id, started_at, finished_at,
                   rows_read, rows_accepted, rows_rejected, message
            FROM src_run
            """;

    private final JdbcTemplate template;
    private final JdbcClient db;
    private final ObjectMapper json;

    IngestionStore(JdbcTemplate template, ObjectMapper json) {
        this.template = template;
        this.db = JdbcClient.create(template);
        this.json = json;
    }

    List<SourceResponse> list() {
        return db.sql(SOURCE + " ORDER BY s.created_at DESC, s.id").query(this::sourceEntry)
                .list().stream().map(SourceEntry::response).toList();
    }

    Optional<SourceEntry> find(String id) {
        return db.sql(SOURCE + " WHERE s.id = :id").param("id", id).query(this::sourceEntry).optional();
    }

    SourceEntry require(String id) {
        return find(id).orElseThrow(() -> new ApiFailure(ApiCode.NOT_FOUND));
    }

    SourceEntry lock(String id) {
        Optional<String> locked = db.sql("SELECT id FROM src_source WHERE id = :id FOR UPDATE")
                .param("id", id).query(String.class).optional();
        if (locked.isEmpty()) {
            throw new ApiFailure(ApiCode.NOT_FOUND);
        }
        return require(id);
    }

    void create(SourceInput input, Instant now, Instant nextDue) {
        db.sql("""
                INSERT INTO src_source (id, current_version, created_at, updated_at, next_due_at)
                VALUES (:id, 1, :created, :created, :next)
                """).param("id", input.id()).param("created", ts(now)).param("next", ts(nextDue)).update();
        insertRevision(input, 1, now);
    }

    void edit(SourceInput input, int newVersion, Instant now, Instant nextDue) {
        insertRevision(input, newVersion, now);
        db.sql("""
                UPDATE src_source
                SET current_version = :version, updated_at = :now, next_due_at = :next, consecutive_failures = 0
                WHERE id = :id
                """).param("version", newVersion).param("now", ts(now)).param("next", ts(nextDue))
                .param("id", input.id()).update();
    }

    private void insertRevision(SourceInput input, int version, Instant now) {
        db.sql("""
                INSERT INTO src_revision (source_id, version_no, definition, created_at)
                VALUES (:id, :version, :definition, :now)
                """).param("id", input.id()).param("version", version)
                .param("definition", json.writeValueAsString(input)).param("now", ts(now)).update();
    }

    void saveAsset(Asset asset, byte[] contents) {
        db.sql("""
                INSERT INTO src_asset (id, file_name, size_bytes, contents, created_at)
                VALUES (:id, :name, :size, :contents, :created)
                """).param("id", asset.id()).param("name", asset.fileName()).param("size", asset.sizeBytes())
                .param("contents", contents).param("created", ts(asset.createdAt())).update();
    }

    boolean hasAsset(String id) {
        return db.sql("SELECT id FROM src_asset WHERE id = :id").param("id", id).query(String.class)
                .optional().isPresent();
    }

    byte[] assetContents(String id) {
        return db.sql("SELECT contents FROM src_asset WHERE id = :id").param("id", id)
                .query((row, number) -> row.getBytes(1)).optional()
                .orElseThrow(() -> new ApiFailure(ApiCode.NOT_FOUND));
    }

    void startRun(String sourceId, int version, String runId, Trigger trigger, String retryOf,
                  String requestKeyHash, Instant started, Instant leaseUntil) {
        db.sql("""
                INSERT INTO src_run (id, source_id, source_version, status, trigger_type, retry_of,
                                     request_key_hash, started_at, rows_read, rows_accepted, rows_rejected, message)
                VALUES (:run, :source, :version, 'RUNNING', :trigger, :retry, :key, :started, 0, 0, 0, '同步运行中')
                """).param("run", runId).param("source", sourceId).param("version", version).param("trigger", trigger.name())
                .param("retry", retryOf).param("key", requestKeyHash).param("started", ts(started)).update();
        db.sql("""
                UPDATE src_source SET active_run_id = :run, lease_until = :lease, last_run_id = :run
                WHERE id = :source
                """).param("run", runId).param("lease", ts(leaseUntil)).param("source", sourceId).update();
    }

    Optional<SyncRun> findRun(String sourceId, String runId) {
        return db.sql(RUN + " WHERE source_id = :source AND id = :id").param("source", sourceId).param("id", runId)
                .query(this::run).optional();
    }

    SyncRun requireRun(String sourceId, String runId) {
        return findRun(sourceId, runId).orElseThrow(() -> new ApiFailure(ApiCode.NOT_FOUND));
    }

    Optional<SyncRun> findRequest(String sourceId, String keyHash) {
        return db.sql(RUN + " WHERE source_id = :source AND request_key_hash = :key")
                .param("source", sourceId).param("key", keyHash).query(this::run).optional();
    }

    List<SyncRun> runs(String sourceId) {
        return db.sql(RUN + " WHERE source_id = :source ORDER BY started_at DESC, id DESC LIMIT 30")
                .param("source", sourceId).query(this::run).list();
    }

    void finishRun(String runId, RunStatus status, String batchId, Instant now,
                   int read, int accepted, int rejected, String message) {
        db.sql("""
                UPDATE src_run SET status = :status, batch_id = :batch, finished_at = :now,
                                   rows_read = :read, rows_accepted = :accepted, rows_rejected = :rejected,
                                   message = :message
                WHERE id = :id AND status = 'RUNNING'
                """).param("id", runId).param("status", status.name()).param("batch", batchId).param("now", ts(now))
                .param("read", read).param("accepted", accepted).param("rejected", rejected)
                .param("message", message).update();
    }

    void releaseLease(String sourceId, String runId, String latestBatch, Instant nextDue, int failures) {
        db.sql("""
                UPDATE src_source
                SET active_run_id = NULL, lease_until = NULL, last_success_batch_id = :batch,
                    next_due_at = :due, consecutive_failures = :failures
                WHERE id = :source AND active_run_id = :run
                """).param("source", sourceId).param("run", runId).param("batch", latestBatch)
                .param("due", ts(nextDue)).param("failures", failures).update();
    }

    List<String> expiredSources(Instant now) {
        return db.sql("""
                SELECT id FROM src_source WHERE active_run_id IS NOT NULL AND lease_until <= :now
                ORDER BY lease_until LIMIT 20
                """).param("now", ts(now)).query(String.class).list();
    }

    List<String> dueSources(Instant now) {
        return db.sql("""
                SELECT id FROM src_source WHERE active_run_id IS NULL AND next_due_at <= :now
                ORDER BY next_due_at, id LIMIT 4
                """).param("now", ts(now)).query(String.class).list();
    }

    Optional<String> findBatch(String sourceId, String fingerprint) {
        return db.sql("SELECT id FROM src_batch WHERE source_id = :source AND fingerprint = :hash")
                .param("source", sourceId).param("hash", fingerprint).query(String.class).optional();
    }

    void saveBatch(String batchId, String sourceId, int version, String fingerprint, Instant synced,
                   List<Observation> observations) {
        db.sql("""
                INSERT INTO src_batch (id, source_id, source_version, fingerprint, synced_at)
                VALUES (:id, :source, :version, :hash, :synced)
                """).param("id", batchId).param("source", sourceId).param("version", version)
                .param("hash", fingerprint).param("synced", ts(synced)).update();
        template.batchUpdate("""
                INSERT INTO src_observation (batch_id, region_id, observed_on, measure, metric_value, denominator)
                VALUES (?, ?, ?, ?, ?, ?)
                """, observations, 100, (statement, row) -> {
            statement.setString(1, batchId);
            statement.setString(2, row.regionId());
            statement.setObject(3, row.observedOn());
            statement.setString(4, row.measure());
            statement.setBigDecimal(5, row.value());
            statement.setBigDecimal(6, row.denominator());
        });
        db.sql("""
                INSERT INTO src_observation_coverage (batch_id, measure, region_id, latest_day, rate_invalid)
                SELECT batch_id, measure, region_id, MAX(observed_on),
                       MAX(CASE WHEN denominator IS NULL OR denominator <= 0 OR metric_value < 0
                                     OR metric_value > denominator THEN 1 ELSE 0 END)
                FROM src_observation WHERE batch_id = :batch
                GROUP BY batch_id, measure, region_id
                """).param("batch", batchId).update();
    }

    List<Observation> observations(String batchId) {
        return db.sql("""
                SELECT region_id, observed_on, measure, metric_value, denominator
                FROM src_observation WHERE batch_id = :batch ORDER BY region_id, observed_on, measure
                """).param("batch", batchId).query(this::observation).list();
    }

    DatasetSummary datasetSummary(String batchId, Instant syncedAt) {
        List<MeasureCount> counts = db.sql("""
                SELECT measure, COUNT(*) AS row_count FROM src_observation
                WHERE batch_id = :batch GROUP BY measure
                """).param("batch", batchId)
                .query((row, index) -> new MeasureCount(row.getString("measure"), row.getLong("row_count"))).list();
        int rowCount = Math.toIntExact(counts.stream().mapToLong(MeasureCount::count).sum());
        return new DatasetSummary(batchId, syncedAt, rowCount, counts.stream().map(MeasureCount::measure).sorted().toList());
    }

    private record MeasureCount(String measure, long count) {
    }

    List<Coverage> coverage(String batchId, String measure) {
        return db.sql("""
                SELECT region_id, latest_day, rate_invalid FROM src_observation_coverage
                WHERE batch_id = :batch AND measure = :measure
                """).param("batch", batchId).param("measure", measure).query((row, index) -> new Coverage(
                row.getString("region_id"), row.getObject("latest_day", LocalDate.class),
                row.getBoolean("rate_invalid"))).list();
    }

    List<Observation> observationWindow(String batchId, String measure, List<String> regionIds,
                                        LocalDate start, LocalDate end) {
        return db.sql("""
                SELECT region_id, observed_on, measure, metric_value, denominator
                FROM src_observation
                WHERE batch_id = :batch AND measure = :measure AND region_id IN (:regions)
                  AND observed_on BETWEEN :start AND :end
                """).param("batch", batchId).param("measure", measure).param("regions", regionIds)
                .param("start", start).param("end", end).query(this::observation).list();
    }

    private Observation observation(ResultSet row, int index) throws SQLException {
        return new Observation(row.getString("region_id"), row.getObject("observed_on", LocalDate.class),
                row.getString("measure"), row.getBigDecimal("metric_value"), row.getBigDecimal("denominator"));
    }

    private SourceEntry sourceEntry(ResultSet row, int index) throws SQLException {
        SourceInput payload = json.readValue(row.getString("definition"), SourceInput.class);
        String lastStatus = row.getString("last_status");
        SourceResponse response = new SourceResponse(payload.id(), payload.name(), payload.type(), payload.config(),
                payload.mapping(), payload.refreshMinutes(), row.getInt("current_version"), time(row, "created_at"),
                time(row, "updated_at"), row.getString("last_success_batch_id"), time(row, "last_synced_at"),
                lastStatus == null ? null : RunStatus.valueOf(lastStatus));
        return new SourceEntry(payload, response, time(row, "next_due_at"), row.getString("active_run_id"),
                time(row, "lease_until"), row.getInt("consecutive_failures"));
    }

    private SyncRun run(ResultSet row, int index) throws SQLException {
        return new SyncRun(row.getString("id"), row.getString("source_id"), RunStatus.valueOf(row.getString("status")),
                Trigger.valueOf(row.getString("trigger_type")), row.getString("retry_of"), row.getString("batch_id"),
                time(row, "started_at"), time(row, "finished_at"), row.getInt("rows_read"),
                row.getInt("rows_accepted"), row.getInt("rows_rejected"), row.getString("message"));
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Instant time(ResultSet row, String name) throws SQLException {
        Timestamp value = row.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }

    record SourceEntry(SourceInput input, SourceResponse response, Instant nextDueAt, String activeRun,
                       Instant leaseUntil, int failures) {
    }
}
