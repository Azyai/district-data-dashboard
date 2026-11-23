package gov.district.dashboard.ingestion;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
class IngestionScheduling {

    private static final Logger LOG = LoggerFactory.getLogger(IngestionScheduling.class);

    private final IngestionStore store;
    private final IngestionService ingestion;

    IngestionScheduling(IngestionStore store, IngestionService ingestion) {
        this.store = store;
        this.ingestion = ingestion;
    }

    @Scheduled(initialDelayString = "${district.ingestion.scheduler-delay-ms:15000}",
            fixedDelayString = "${district.ingestion.scheduler-delay-ms:15000}")
    void poll() {
        Instant now = Instant.now();
        for (String id : store.expiredSources(now)) {
            handle(id, () -> ingestion.recoverExpired(id));
        }
        for (String id : store.dueSources(now)) {
            handle(id, () -> ingestion.syncScheduled(id));
        }
    }

    private void handle(String sourceId, Runnable work) {
        try {
            work.run();
        } catch (RuntimeException failure) {
            LOG.warn("Scheduled ingestion operation failed for source {} ({})", sourceId, failure.getClass().getSimpleName());
        }
    }
}
