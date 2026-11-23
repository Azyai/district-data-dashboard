package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.catalog.MetricCatalogService;
import gov.district.dashboard.catalog.MetricInput;
import gov.district.dashboard.catalog.MetricRecord;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import gov.district.dashboard.platform.api.ApiResult;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
@RequestMapping("/api/v1/admin/metrics")
class AdminMetricController {

    private final MetricCatalogService metrics;

    AdminMetricController(MetricCatalogService metrics) {
        this.metrics = metrics;
    }

    @GetMapping
    ApiResult<List<MetricRecord>> list() {
        return ApiResult.ok(metrics.list());
    }

    @PostMapping
    ApiResult<MetricRecord> create(@Valid @RequestBody MetricInput input) {
        return ApiResult.ok(metrics.create(input));
    }

    @PutMapping("/{id}")
    ApiResult<MetricRecord> update(@PathVariable String id,
            @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody MetricInput input) {
        return ApiResult.ok(metrics.update(id, revision(ifMatch), input));
    }

    @PostMapping("/{id}/publish")
    ApiResult<MetricRecord> publish(@PathVariable String id,
            @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        return ApiResult.ok(metrics.publish(id, revision(ifMatch)));
    }

    private static long revision(String ifMatch) {
        if (ifMatch == null) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        String value = ifMatch.strip();
        if (value.matches("\"[1-9][0-9]{0,18}\"")) {
            value = value.substring(1, value.length() - 1);
        } else if (!value.matches("[1-9][0-9]{0,18}")) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException invalid) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
    }
}
