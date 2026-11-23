package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.IngestionModels.Asset;
import gov.district.dashboard.ingestion.IngestionModels.ConnectionTest;
import gov.district.dashboard.ingestion.IngestionModels.DatasetSummary;
import gov.district.dashboard.ingestion.IngestionModels.RunStatus;
import gov.district.dashboard.ingestion.IngestionModels.SourceConfig;
import gov.district.dashboard.ingestion.IngestionModels.SourceInput;
import gov.district.dashboard.ingestion.IngestionModels.SourceOptions;
import gov.district.dashboard.ingestion.IngestionModels.SourceResponse;
import gov.district.dashboard.ingestion.IngestionModels.SyncRun;
import gov.district.dashboard.ingestion.IngestionModels.Trigger;
import gov.district.dashboard.ingestion.IngestionStore.SourceEntry;
import gov.district.dashboard.ingestion.ObservationQuality.Check;
import gov.district.dashboard.ingestion.SourceReader.ReadFailure;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public final class IngestionService {

    private static final Pattern SOURCE_ID = Pattern.compile("[a-z][a-z0-9-]{0,63}");
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[A-Za-z0-9_.:-]{1,128}");
    private static final Duration RUN_LEASE = Duration.ofSeconds(90);

    private final IngestionStore store;
    private final SourceRegistry registry;
    private final SourceReader reader;
    private final TransactionTemplate transactions;
    private final Semaphore csvUploadSlots = new Semaphore(2);

    IngestionService(IngestionStore store, SourceRegistry registry, SourceReader reader,
                     PlatformTransactionManager transactionManager) {
        this.store = store;
        this.registry = registry;
        this.reader = reader;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public Optional<DatasetSnapshot> latest(String sourceId) {
        return store.find(sourceId).map(SourceEntry::response)
                .filter(source -> source.lastSuccessBatchId() != null)
                .map(source -> new DatasetSnapshot(source.id(), source.name(), source.lastSuccessBatchId(),
                        source.lastSuccessfulAt(), store.observations(source.lastSuccessBatchId())));
    }

    List<SourceResponse> list() {
        return store.list();
    }

    SourceResponse show(String id) {
        return store.require(id).response();
    }

    SourceResponse create(SourceInput raw) {
        SourceInput input = validate(raw);
        Instant now = now();
        try {
            return transactions.execute(ignored -> {
                store.create(input, now, nextDue(input.refreshMinutes(), now, 0));
                return store.require(input.id()).response();
            });
        } catch (DuplicateKeyException duplicate) {
            throw new ApiFailure(ApiCode.ALREADY_EXISTS);
        }
    }

    SourceResponse update(String id, SourceInput raw, String ifMatch) {
        SourceInput input = validate(raw);
        require(id.equals(input.id()));
        int expectedVersion = readVersion(ifMatch);
        Instant now = now();
        return transactions.execute(ignored -> {
            SourceEntry saved = store.lock(id);
            requireVersion(saved.response().version() == expectedVersion);
            store.edit(input, expectedVersion + 1, now, nextDue(input.refreshMinutes(), now, 0));
            return store.require(id).response();
        });
    }

    Asset upload(String name, InputStream stream) {
        require(name != null);
        String fileName = name.strip();
        require(fileName.length() >= 5 && fileName.length() <= 160 && fileName.codePoints().noneMatch(Character::isISOControl)
                && fileName.codePoints().noneMatch(cp -> Character.getType(cp) == Character.FORMAT)
                && fileName.indexOf('/') < 0 && fileName.indexOf('\\') < 0 && fileName.indexOf(':') < 0
                && fileName.toLowerCase(Locale.ROOT).endsWith(".csv"));
        if (!csvUploadSlots.tryAcquire()) {
            throw new ApiFailure(ApiCode.INTERNAL_ERROR);
        }
        try {
            byte[] contents = stream.readNBytes(SourceReader.MAX_BYTES + 1);
            require(contents.length > 0 && contents.length <= SourceReader.MAX_BYTES);
            reader.validateCsv(contents);
            Asset asset = new Asset(id(), fileName, contents.length, now());
            store.saveAsset(asset, contents);
            return asset;
        } catch (IOException | ReadFailure invalidFile) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        } finally {
            csvUploadSlots.release();
        }
    }

    SourceOptions options() {
        return registry.options();
    }

    DatasetSummary dataset(String sourceId) {
        SourceResponse source = store.require(sourceId).response();
        if (source.lastSuccessBatchId() == null) {
            throw new ApiFailure(ApiCode.DATASET_REQUIRED);
        }
        return store.datasetSummary(source.lastSuccessBatchId(), source.lastSuccessfulAt());
    }

    ConnectionTest testConnection(String sourceId) {
        SourceInput input = store.require(sourceId).input();
        try {
            var raw = reader.read(input);
            Check check = ObservationQuality.inspect(raw, input.mapping());
            return new ConnectionTest(check.passed() ? "PASSED" : "FAILED", check.message(), raw.fields(),
                    check.accepted().stream().limit(5).toList(), check.total(), check.rejected());
        } catch (ReadFailure unavailable) {
            return new ConnectionTest("FAILED", unavailable.getMessage(), List.of(), List.of(), 0, 0);
        }
    }

    List<SyncRun> runs(String sourceId) {
        store.require(sourceId);
        return store.runs(sourceId);
    }

    SyncRun syncManually(String sourceId, String retryOf, String requestKey) {
        require(retryOf == null || isUuid(retryOf));
        require(requestKey == null || IDEMPOTENCY_KEY.matcher(requestKey).matches());
        Trigger trigger = retryOf == null ? Trigger.MANUAL : Trigger.RETRY;
        return sync(sourceId, trigger, retryOf, requestKey == null ? null : keyHash(requestKey));
    }

    void syncScheduled(String sourceId) {
        sync(sourceId, Trigger.SCHEDULED, null, null);
    }

    void recoverExpired(String sourceId) {
        transactions.executeWithoutResult(ignored -> expire(store.lock(sourceId), now()));
    }

    private SyncRun sync(String sourceId, Trigger trigger, String retryOf, String keyHash) {
        Work work = transactions.execute(ignored -> begin(sourceId, trigger, retryOf, keyHash, now()));
        if (work == null || work.input() == null) {
            return work == null ? null : work.prior();
        }

        Outcome outcome;
        try {
            var raw = reader.read(work.input());
            Check quality = ObservationQuality.inspect(raw, work.input().mapping());
            outcome = new Outcome(quality.passed() ? RunStatus.SUCCEEDED : RunStatus.REJECTED,
                    quality.accepted(), quality.total(), quality.rejected(), quality.message());
        } catch (ReadFailure unavailable) {
            outcome = new Outcome(RunStatus.FAILED, List.of(), 0, 0, unavailable.getMessage());
        }
        Outcome finished = outcome;
        return transactions.execute(ignored -> complete(work, finished, now()));
    }

    private Work begin(String sourceId, Trigger trigger, String retryOf, String requestKeyHash, Instant started) {
        SourceEntry current = store.lock(sourceId);
        if (expire(current, started)) {
            current = store.require(sourceId);
        }
        if (requestKeyHash != null) {
            Optional<SyncRun> prior = store.findRequest(sourceId, requestKeyHash);
            if (prior.isPresent()) {
                if (!Objects.equals(prior.get().retryOf(), retryOf)) {
                    throw new ApiFailure(ApiCode.ALREADY_EXISTS);
                }
                return new Work(null, 0, prior.get().id(), prior.get());
            }
        }

        if (trigger == Trigger.SCHEDULED && (current.activeRun() != null || current.nextDueAt() == null
                || current.nextDueAt().isAfter(started))) {
            return null;
        }
        requireVersion(current.activeRun() == null);
        if (retryOf != null) {
            requireVersion(store.requireRun(sourceId, retryOf).status() != RunStatus.RUNNING);
        }

        String runId = id();
        int version = current.response().version();
        store.startRun(sourceId, version, runId, trigger, retryOf, requestKeyHash, started, started.plus(RUN_LEASE));
        return new Work(current.input(), version, runId, null);
    }

    private SyncRun complete(Work work, Outcome outcome, Instant finishedAt) {
        String sourceId = work.input().id();
        SourceEntry current = store.lock(sourceId);
        if (!work.runId().equals(current.activeRun())) {
            return store.requireRun(sourceId, work.runId());
        }
        if (expire(current, finishedAt)) {
            return store.requireRun(sourceId, work.runId());
        }

        if (current.response().version() != work.version()) {
            store.finishRun(work.runId(), RunStatus.FAILED, null, finishedAt,
                    outcome.rowsRead(), outcome.rows().size(), outcome.rejected(), "配置在同步期间更新，请重新同步");
            store.releaseLease(sourceId, work.runId(), current.response().lastSuccessBatchId(), current.nextDueAt(),
                    current.failures());
            return store.requireRun(sourceId, work.runId());
        }

        String batchId = null;
        if (outcome.status() == RunStatus.SUCCEEDED) {
            String fingerprint = ObservationQuality.fingerprint(outcome.rows());
            batchId = store.findBatch(sourceId, fingerprint).orElseGet(() -> {
                String newId = id();
                store.saveBatch(newId, sourceId, work.version(), fingerprint, finishedAt, outcome.rows());
                return newId;
            });
        }

        store.finishRun(work.runId(), outcome.status(), batchId, finishedAt, outcome.rowsRead(), outcome.rows().size(),
                outcome.rejected(), outcome.message());
        int failures = batchId == null ? current.failures() + 1 : 0;
        String latestBatch = batchId == null ? current.response().lastSuccessBatchId() : batchId;
        store.releaseLease(sourceId, work.runId(), latestBatch,
                nextDue(current.input().refreshMinutes(), finishedAt, failures), failures);
        return store.requireRun(sourceId, work.runId());
    }

    private boolean expire(SourceEntry source, Instant now) {
        if (source.activeRun() == null || source.leaseUntil().isAfter(now)) {
            return false;
        }
        store.finishRun(source.activeRun(), RunStatus.FAILED, null, now, 0, 0, 0, "同步租约失效，可重新发起");
        int failures = source.failures() + 1;
        store.releaseLease(source.input().id(), source.activeRun(), source.response().lastSuccessBatchId(),
                nextDue(source.input().refreshMinutes(), now, failures), failures);
        return true;
    }

    private SourceInput validate(SourceInput input) {
        require(input != null && input.id() != null && SOURCE_ID.matcher(input.id()).matches()
                && input.name() != null && !input.name().isBlank() && input.name().length() <= 100
                && input.name().codePoints().noneMatch(Character::isISOControl)
                && input.type() != null && input.config() != null && input.mapping() != null
                && input.refreshMinutes() != null && input.refreshMinutes() >= 0 && input.refreshMinutes() <= 1440);
        var mapping = input.mapping();
        require(mapping.region() != null && mapping.date() != null && mapping.measure() != null && mapping.value() != null);
        List<String> fields = ObservationQuality.mappedFields(mapping);
        require(new HashSet<>(fields).size() == fields.size()
                && fields.stream().allMatch(name -> SourceReader.FIELD.matcher(name).matches()));
        SourceConfig config = input.config();
        switch (input.type()) {
            case HTTPS_JSON -> {
                require(config.endpoint() != null && config.connectionRef() == null
                        && config.viewRef() == null && config.assetRef() == null);
                registry.https(config.endpoint());
            }
            case MYSQL_VIEW -> {
                require(config.endpoint() == null && config.connectionRef() != null
                        && config.viewRef() != null && config.assetRef() == null);
                registry.mysql(config.connectionRef(), config.viewRef());
            }
            case CSV -> {
                require(config.endpoint() == null && config.connectionRef() == null && config.viewRef() == null
                        && isUuid(config.assetRef()));
                if (!store.hasAsset(config.assetRef())) {
                    throw new ApiFailure(ApiCode.NOT_FOUND);
                }
            }
        }
        return new SourceInput(input.id(), input.name().strip(), input.type(), config, mapping, input.refreshMinutes());
    }

    private static Instant nextDue(int refresh, Instant now, int failures) {
        if (refresh == 0) {
            return null;
        }
        int backoff = failures == 0 ? 0 : Math.min(30, 1 << Math.min(failures, 5));
        return now.plus(Math.max(refresh, backoff), ChronoUnit.MINUTES);
    }

    private static int readVersion(String input) {
        require(input != null);
        String value = input.strip();
        if (value.length() > 1 && value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length() - 1);
        }
        require(value.matches("[1-9][0-9]{0,9}"));
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException malformed) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
    }

    private static boolean isUuid(String value) {
        if (value == null || value.length() != 36) {
            return false;
        }
        try {
            return UUID.fromString(value).toString().equals(value);
        } catch (IllegalArgumentException malformed) {
            return false;
        }
    }

    private static String keyHash(String key) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 unavailable", unavailable);
        }
    }

    private static String id() {
        return UUID.randomUUID().toString();
    }

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MILLIS);
    }

    private static void require(boolean valid) {
        if (!valid) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
    }

    private static void requireVersion(boolean current) {
        if (!current) {
            throw new ApiFailure(ApiCode.VERSION_CONFLICT);
        }
    }

    private record Work(SourceInput input, int version, String runId, SyncRun prior) {
    }

    private record Outcome(RunStatus status, List<Observation> rows, int rowsRead, int rejected, String message) {
    }
}
