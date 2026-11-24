package gov.district.dashboard.demo.cockpit;

import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("demo")
public class CockpitSideMetrics {

    private final CockpitSideMetricsMapper mapper;

    CockpitSideMetrics(CockpitSideMetricsMapper mapper) {
        this.mapper = mapper;
    }

    public Settings read() {
        return mapper.read().toSettings();
    }

    @Transactional
    public Settings save(long revision, List<String> left, List<String> right) {
        Set<String> selected = new HashSet<>(left);
        selected.addAll(right);
        if (selected.size() != left.size() + right.size()) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        DemoCockpitService.BASELINE.forEach(metric -> selected.remove(metric.id()));
        if (!selected.isEmpty() && mapper.countPublished(selected) != selected.size()) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        if (mapper.replace(revision, String.join(",", left), String.join(",", right)) != 1) {
            throw new ApiFailure(ApiCode.VERSION_CONFLICT);
        }
        return new Settings(revision + 1, left, right);
    }

    public record Settings(long revision, List<String> left, List<String> right) {}
}
