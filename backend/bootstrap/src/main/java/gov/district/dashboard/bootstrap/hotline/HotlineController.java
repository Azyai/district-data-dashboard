package gov.district.dashboard.bootstrap.hotline;

import gov.district.dashboard.platform.api.ApiResult;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
@RequestMapping("/api/v1/hotline")
class HotlineController {
    private final HotlineService service;

    HotlineController(HotlineService service) {
        this.service = service;
    }

    @GetMapping("/overview")
    ApiResult<HotlineService.Overview> overview(@RequestParam(defaultValue = "mentougou") String areaId,
                                               @RequestParam(defaultValue = "2026-10") String month) {
        return ApiResult.ok(service.overview(areaId, month));
    }

    @GetMapping("/tickets")
    ApiResult<HotlineService.TicketPage> tickets(@RequestParam(defaultValue = "mentougou") String areaId,
                                                @RequestParam(defaultValue = "2026-10") String month,
                                                @RequestParam(defaultValue = "all") String lane,
                                                @RequestParam(defaultValue = "all") String category,
                                                @RequestParam(defaultValue = "0") String page,
                                                @RequestParam(defaultValue = "20") String size) {
        return ApiResult.ok(service.tickets(areaId, month, lane, category, page, size));
    }

    @GetMapping("/tickets/{id}")
    ApiResult<HotlineService.TicketDetails> ticketDetails(@PathVariable String id,
                                                         @RequestParam(defaultValue = "mentougou") String areaId,
                                                         @RequestParam(required = false) String month) {
        return ApiResult.ok(service.ticketDetails(id, areaId, month));
    }

    @GetMapping("/analysis")
    ApiResult<HotlineService.Analysis> analysis(@RequestParam(defaultValue = "mentougou") String areaId,
                                               @RequestParam(defaultValue = "2026-10") String month) {
        return ApiResult.ok(service.analysis(areaId, month));
    }

    @GetMapping("/semantics")
    ApiResult<HotlineService.Semantics> semantics() {
        return ApiResult.ok(service.semantics());
    }
}
