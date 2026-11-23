package gov.district.dashboard.catalog;

import gov.district.dashboard.catalog.MetricInput.Aggregation;
import gov.district.dashboard.catalog.MetricRecord.Published;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("demo")
public class MetricCatalogService {

    private final MetricMapper mapper;
    private final MetricQuery query;

    MetricCatalogService(MetricMapper mapper, MetricQuery query) {
        this.mapper = mapper;
        this.query = query;
    }

    @Transactional(readOnly = true)
    public List<MetricRecord> list() {
        return mapper.findAll().stream().map(MetricRow::toRecord).toList();
    }

    @Transactional
    public MetricRecord create(MetricInput input) {
        MetricInput draft = normalized(input);
        try {
            mapper.insertDraft(draft);
        } catch (DuplicateKeyException duplicate) {
            throw new ApiFailure(ApiCode.ALREADY_EXISTS);
        }
        return new MetricRecord(draft.id(), 1, draft, null);
    }

    @Transactional
    public MetricRecord update(String id, long revision, MetricInput input) {
        if (!id.equals(input.id())) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        MetricInput draft = normalized(input);
        MetricRecord previous = withRevision(id, revision);
        if (previous.draft().equals(draft)) {
            return previous;
        }
        checkUpdated(mapper.updateDraft(draft, revision));
        return new MetricRecord(id, revision + 1, draft, previous.published());
    }

    @Transactional
    public MetricRecord publish(String id, long revision) {
        MetricRecord previous = withRevision(id, revision);
        MetricInput draft = previous.draft();
        if (previous.published() != null && previous.published().definition().equals(draft)) {
            return previous;
        }

        query.requireAvailable(draft);
        long version = previous.published() == null ? 1 : previous.published().version() + 1;
        Instant publishedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        checkUpdated(mapper.pointToRelease(id, revision, version));
        mapper.insertRelease(draft, version, LocalDateTime.ofInstant(publishedAt, ZoneOffset.UTC));
        return new MetricRecord(id, revision + 1, draft, new Published(draft, version, publishedAt));
    }

    private MetricRecord withRevision(String id, long revision) {
        MetricRow row = mapper.findById(id);
        if (row == null) {
            throw new ApiFailure(ApiCode.NOT_FOUND);
        }
        MetricRecord current = row.toRecord();
        if (current.revision() != revision) {
            throw new ApiFailure(ApiCode.VERSION_CONFLICT);
        }
        return current;
    }

    private static void checkUpdated(int affectedRows) {
        if (affectedRows != 1) {
            throw new ApiFailure(ApiCode.VERSION_CONFLICT);
        }
    }

    private static MetricInput normalized(MetricInput input) {
        String unit = input.unit().strip();
        if ((input.aggregation() == Aggregation.RATE) != "%".equals(unit)) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        return new MetricInput(input.id(), input.label().strip(), unit, input.sourceId(), input.measure(),
                input.aggregation(), input.description().strip());
    }
}
