package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.demo.cockpit.CockpitSideMetrics;
import gov.district.dashboard.demo.cockpit.CockpitSideMetrics.Settings;
import gov.district.dashboard.platform.api.ApiResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
class CockpitSideMetricsController {
    private final CockpitSideMetrics metrics;

    CockpitSideMetricsController(CockpitSideMetrics metrics) {
        this.metrics = metrics;
    }

    @GetMapping("/api/v1/cockpit/side-metrics")
    ApiResult<Settings> read() {
        return ApiResult.ok(metrics.read());
    }

    @PutMapping("/api/v1/admin/cockpit/side-metrics")
    ApiResult<Settings> save(@RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch,
                             @Valid @RequestBody Selection input) {
        return ApiResult.ok(metrics.save(AdminMetricController.revision(ifMatch), input.left(), input.right()));
    }

    record Selection(
            @NotNull @Size(min = 1, max = 3) List<@NotNull @Pattern(regexp = "[a-z][a-z0-9-]{0,63}") String> left,
            @NotNull @Size(min = 1, max = 3) List<@NotNull @Pattern(regexp = "[a-z][a-z0-9-]{0,63}") String> right) {}
}
