package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.demo.cockpit.DemoCockpitService;
import gov.district.dashboard.demo.cockpit.DemoCockpitService.AreaSnapshot;
import gov.district.dashboard.demo.cockpit.DemoCockpitService.Location;
import gov.district.dashboard.platform.api.ApiResult;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
class DemoCockpitController {

    private final DemoCockpitService cockpit;

    DemoCockpitController(DemoCockpitService cockpit) {
        this.cockpit = cockpit;
    }

    @GetMapping("/api/v1/cockpit/locations")
    ApiResult<List<Location>> locations() {
        return ApiResult.ok(cockpit.locations());
    }

    @GetMapping("/api/v1/cockpit/areas/{areaId}")
    ApiResult<AreaSnapshot> area(@PathVariable String areaId) {
        return ApiResult.ok(cockpit.snapshot(areaId));
    }
}
