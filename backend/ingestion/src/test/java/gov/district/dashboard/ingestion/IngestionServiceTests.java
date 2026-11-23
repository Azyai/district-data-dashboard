package gov.district.dashboard.ingestion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import gov.district.dashboard.ingestion.IngestionModels.FieldMapping;
import gov.district.dashboard.ingestion.IngestionModels.RunStatus;
import gov.district.dashboard.ingestion.IngestionModels.SourceConfig;
import gov.district.dashboard.ingestion.IngestionModels.SourceInput;
import gov.district.dashboard.ingestion.IngestionModels.SourceType;
import gov.district.dashboard.ingestion.IngestionModels.Trigger;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import tools.jackson.databind.json.JsonMapper;

class IngestionServiceTests {

    private static final FieldMapping MAPPING = new FieldMapping("region", "date", "measure", "value", "denominator");
    private static final String HEADER = "region,date,measure,value,denominator,internal_note\n";
    private JdbcTemplate jdbc;
    private IngestionStore store;
    private SourceReader sourceReader;
    private IngestionService service;

    @BeforeEach
    void configure() {
        var dataSource = new DriverManagerDataSource("jdbc:h2:mem:ingest-" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(dataSource);
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V3__create_ingestion.sql"),
                new ClassPathResource("db/migration/V5__index_observation_windows.sql")).execute(dataSource);
        var json = JsonMapper.builder().build();
        var registry = new SourceRegistry(json, "[]", "[]");
        store = new IngestionStore(jdbc, json);
        sourceReader = new SourceReader(registry, store, json);
        service = new IngestionService(store, registry, sourceReader, new DataSourceTransactionManager(dataSource));
    }

    @AfterEach
    void close() {
        sourceReader.close();
    }

    @Test
    void validatesCsvSizeAndShapeBeforePersistingAnAsset() {
        String record = "mentougou,2026-11-23,events,22,100,private-note\n";
        var validRows = HEADER + record;
        assertCode(() -> service.upload("data.txt", utf8(validRows)), ApiCode.INVALID_REQUEST);
        assertCode(() -> service.upload("data.csv", utf8(HEADER)), ApiCode.INVALID_REQUEST);
        assertCode(() -> service.upload("data.csv", utf8(HEADER + "mentougou,2026-11-23\n")),
                ApiCode.INVALID_REQUEST);
        assertCode(() -> service.upload("data.csv", new ByteArrayInputStream(new byte[]{(byte) 0xff})),
                ApiCode.INVALID_REQUEST);
        assertCode(() -> service.upload("data.csv", new ByteArrayInputStream(new byte[SourceReader.MAX_BYTES + 1])),
                ApiCode.INVALID_REQUEST);
        assertCode(() -> service.upload("data.csv", utf8(HEADER + record.repeat(SourceReader.MAX_ROWS + 1))),
                ApiCode.INVALID_REQUEST);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM src_asset", Integer.class)).isZero();

        var asset = service.upload("季度数据.CSV", utf8("\uFEFF" + validRows));
        assertThat(asset.fileName()).isEqualTo("季度数据.CSV");
        assertThat(asset.sizeBytes()).isEqualTo(("\uFEFF" + validRows).getBytes(StandardCharsets.UTF_8).length);
        assertThat(store.hasAsset(asset.id())).isTrue();
    }

    @Test
    void persistsApprovedSnapshotAndProtectsItAcrossDuplicateAndRejectedRuns() {
        String firstAsset = upload("mentougou,2026-11-23,events,22,100,private-note\n");
        var created = service.create(source(firstAsset, 0));
        assertThat(created.version()).isEqualTo(1);
        assertThat(created.lastSuccessBatchId()).isNull();
        assertCode(() -> service.dataset("pilot"), ApiCode.DATASET_REQUIRED);
        assertCode(() -> service.create(source(firstAsset, 0)), ApiCode.ALREADY_EXISTS);

        var preview = service.testConnection("pilot");
        assertThat(preview.fields()).contains("internal_note");
        assertThat(preview.preview()).hasSize(1);
        assertThat(preview.toString()).doesNotContain("private-note");

        var first = service.syncManually("pilot", null, "manual-1");
        assertThat(first.status()).isEqualTo(RunStatus.SUCCEEDED);
        assertThat(service.syncManually("pilot", null, "manual-1").id()).isEqualTo(first.id());
        assertThat(service.syncManually("pilot", first.id(), "retried").batchId()).isEqualTo(first.batchId());
        assertThat(service.runs("pilot")).hasSize(2);
        assertThat(service.latest("pilot")).hasValueSatisfying(snapshot -> {
            assertThat(snapshot.batchId()).isEqualTo(first.batchId());
            assertThat(snapshot.observations()).singleElement().satisfies(observation ->
                    assertThat(observation.value()).isEqualByComparingTo("22"));
        });

        String invalidAsset = upload("mentougou,2026-11-23,events,23,100,synthetic\n"
                + "mentougou,2026-11-23,events,broken,100,never-echo\n");
        var updated = service.update("pilot", source(invalidAsset, 0), "\"1\"");
        assertThat(updated.version()).isEqualTo(2);
        assertCode(() -> service.update("pilot", source(firstAsset, 0), "1"), ApiCode.VERSION_CONFLICT);

        var rejected = service.syncManually("pilot", null, null);
        assertThat(rejected.status()).isEqualTo(RunStatus.REJECTED);
        assertThat(rejected.rowsAccepted()).isEqualTo(1);
        assertThat(rejected.rowsRejected()).isEqualTo(1);
        assertThat(rejected.message()).contains("第 2 条").doesNotContain("never-echo");
        assertThat(service.dataset("pilot").batchId()).isEqualTo(first.batchId());
        assertThat(service.show("pilot").lastSyncStatus()).isEqualTo(RunStatus.REJECTED);
    }

    @Test
    void schedulesDueWorkAndRecoversAnExpiredRunWithoutReplacingTheLatestSuccess() {
        String asset = upload("mentougou,2026-11-23,events,12,100,synthetic\n");
        service.create(source(asset, 1));
        jdbc.update("UPDATE src_source SET next_due_at = ? WHERE id = 'pilot'",
                Timestamp.from(Instant.now().minusSeconds(5)));

        new IngestionScheduling(store, service).poll();
        var scheduled = service.runs("pilot").getFirst();
        assertThat(scheduled.status()).isEqualTo(RunStatus.SUCCEEDED);
        assertThat(scheduled.trigger()).isEqualTo(Trigger.SCHEDULED);
        assertThat(service.dataset("pilot").batchId()).isEqualTo(scheduled.batchId());

        String abandoned = UUID.randomUUID().toString();
        Instant past = Instant.now().minusSeconds(180);
        store.startRun("pilot", 1, abandoned, Trigger.MANUAL, null, null, past, past.plusSeconds(90));
        service.recoverExpired("pilot");
        assertThat(store.requireRun("pilot", abandoned).status()).isEqualTo(RunStatus.FAILED);
        assertThat(service.dataset("pilot").batchId()).isEqualTo(scheduled.batchId());
        var retry = service.syncManually("pilot", abandoned, "retry-expired");
        assertThat(retry.trigger()).isEqualTo(Trigger.RETRY);
        assertThat(retry.batchId()).isEqualTo(scheduled.batchId());
    }

    @Test
    void readsBoundedObservationWindowsWhileKeepingHistoricalQuality() {
        var rows = new StringBuilder("mentougou,2026-11-01,events,90,20,historical-invalid\n"
                + "mentougou,2026-11-23,events,22,100,latest\n"
                + "mentougou,2026-11-23,traffic,8,,other-measure\n"
                + "excluded,2026-11-24,events,25,100,other-branch\n");
        var selected = new ArrayList<String>();
        selected.add("mentougou");
        for (int i = 0; i < 128; i++) {
            String region = "test-region-" + i;
            selected.add(region);
            rows.append(region).append(",2026-11-17,events,3,10,inside-window\n");
            rows.append(region).append(",2026-11-16,events,4,10,outside-window\n");
        }

        service.create(source(upload(rows.toString()), 0));
        var completed = service.syncManually("pilot", null, null);
        assertThat(completed.status()).isEqualTo(RunStatus.SUCCEEDED);
        var summary = service.dataset("pilot");
        assertThat(summary.rowCount()).isEqualTo(260);
        assertThat(summary.measures()).containsExactly("events", "traffic");
        var query = new DatasetQuery(store);
        var batch = query.latest("pilot").orElseThrow();
        assertThat(batch.batchId()).isEqualTo(completed.batchId());
        assertThat(query.coverage(batch, "events")).hasSize(130).filteredOn(DatasetQuery.Coverage::invalidRate)
                .containsExactly(new DatasetQuery.Coverage("mentougou", LocalDate.of(2026, 11, 23), true));

        var recent = query.latestWindow(batch, "events", selected, LocalDate.of(2026, 11, 23));
        assertThat(recent).hasSize(129).extracting(Observation::regionId).containsExactlyInAnyOrderElementsOf(selected);
        assertThat(recent).extracting(Observation::observedOn).containsOnly(
                LocalDate.of(2026, 11, 17), LocalDate.of(2026, 11, 23));
        assertThat(recent).extracting(Observation::measure).containsOnly("events");
    }

    private String upload(String rows) {
        return service.upload("pilot.csv", utf8(HEADER + rows)).id();
    }

    private static ByteArrayInputStream utf8(String text) {
        return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
    }

    private SourceInput source(String assetId, int refresh) {
        return new SourceInput("pilot", "测试来源", SourceType.CSV, new SourceConfig(null, null, null, assetId),
                MAPPING, refresh);
    }

    private void assertCode(Runnable work, ApiCode code) {
        assertThatThrownBy(work::run).isInstanceOfSatisfying(ApiFailure.class,
                error -> assertThat(error.code()).isEqualTo(code));
    }
}
