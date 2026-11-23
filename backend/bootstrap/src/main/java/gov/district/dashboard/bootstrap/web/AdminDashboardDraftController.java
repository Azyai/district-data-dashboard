package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.demo.DashboardDraftService;
import gov.district.dashboard.demo.DashboardDraftService.SavedDraft;
import gov.district.dashboard.demo.DashboardDraftService.Workspace;
import gov.district.dashboard.demo.DemoPlaybackService.Component;
import gov.district.dashboard.demo.DemoPlaybackService.Geometry;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import gov.district.dashboard.platform.api.ApiResult;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@Profile("demo")
@RequestMapping("/api/v1/admin/dashboards/{projectId}/draft")
class AdminDashboardDraftController {

    private static final Pattern REVISION = Pattern.compile("\"(0|[1-9][0-9]{0,9})\"");
    private final DashboardDraftService drafts;

    AdminDashboardDraftController(DashboardDraftService drafts) {
        this.drafts = drafts;
    }

    @GetMapping
    ApiResult<Workspace> read(@PathVariable String projectId) {
        return ApiResult.ok(drafts.read(projectId));
    }

    @PutMapping
    ApiResult<SavedDraft> save(@PathVariable String projectId,
                              @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
                              @RequestBody JsonNode body) {
        return ApiResult.ok(drafts.save(projectId, revision(ifMatch), components(body)));
    }

    private static int revision(String ifMatch) {
        if (ifMatch == null) {
            throw invalid();
        }
        var match = REVISION.matcher(ifMatch.strip());
        if (!match.matches()) {
            throw invalid();
        }
        try {
            return Integer.parseInt(match.group(1));
        } catch (NumberFormatException overflow) {
            throw invalid();
        }
    }

    private static List<Component> components(JsonNode body) {
        JsonNode input = body.path("components");
        if (!body.isObject() || body.size() != 1 || !input.isArray()
                || input.size() > DashboardDraftService.MAX_COMPONENTS) {
            throw invalid();
        }
        List<Component> components = new ArrayList<>(input.size());
        for (JsonNode item : input) {
            JsonNode geometry = item.path("geometry");
            if (!item.isObject() || item.size() != 6 || !geometry.isObject() || geometry.size() != 5) {
                throw invalid();
            }
            components.add(new Component(text(item, "id"), text(item, "title"), text(item, "type"),
                    text(item, "metricId"), text(item, "unit"),
                    new Geometry(integer(geometry, "x"), integer(geometry, "y"), integer(geometry, "width"),
                            integer(geometry, "height"), integer(geometry, "z"))));
        }
        return components;
    }

    private static String text(JsonNode node, String key) {
        JsonNode value = node.path(key);
        if (!value.isString()) {
            throw invalid();
        }
        return value.asString();
    }

    private static int integer(JsonNode node, String key) {
        JsonNode value = node.path(key);
        if (!value.isIntegralNumber() || !value.canConvertToInt()) {
            throw invalid();
        }
        return value.asInt();
    }

    private static ApiFailure invalid() {
        return new ApiFailure(ApiCode.INVALID_REQUEST);
    }
}
