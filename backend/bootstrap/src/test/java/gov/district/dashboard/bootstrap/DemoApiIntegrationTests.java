package gov.district.dashboard.bootstrap;

import gov.district.dashboard.bootstrap.security.WorkspaceSecurity;
import gov.district.dashboard.platform.api.ApiCode;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalManagementPort;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(classes = DistrictDashboardApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "management.server.port=0")
@ActiveProfiles("demo")
class DemoApiIntegrationTests {

    private static final String CITY = "city-operations";
    private static final String SERVICES = "public-services";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @LocalServerPort
    int port;

    @LocalManagementPort
    int managementPort;

    @Test
    void separatesHealthAndBusinessListeners() throws Exception {
        assertThat(managementPort).isPositive().isNotEqualTo(port);
        try (var client = HttpClient.newHttpClient()) {
            var health = requestOnPort(managementPort, "/actuator/health").GET().build();
            var response = client.send(health, HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(JSON.readTree(response.body()).path("status").asString()).isEqualTo("UP");

            var healthOnApi = requestOnPort(port, "/actuator/health").GET().build();
            assertThat(client.send(healthOnApi, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(404);
            var businessOnManagement = requestOnPort(managementPort, "/api/v1/cockpit/locations").GET().build();
            assertThat(client.send(businessOnManagement, HttpResponse.BodyHandlers.discarding()).statusCode())
                    .isIn(401, 403, 404);
        }
    }

    @Test
    void rejectsAnonymousAndUnprotectedRequests() throws Exception {
        try (var browser = new Browser()) {
            browser.get("/me", ApiCode.AUTH_REQUIRED);
            browser.get("/projects/recommendations", ApiCode.AUTH_REQUIRED);
            browser.post("/auth/demo-session", persona("district"), null, ApiCode.CSRF_INVALID);

            var csrf = browser.csrf();
            browser.post("/auth/demo-session", persona("unsupported"), csrf, ApiCode.INVALID_REQUEST);
            browser.get("/me", ApiCode.AUTH_REQUIRED);
        }
    }

    @Test
    void retiresPresentationConfigurationEndpoints() throws Exception {
        try (var admin = new Browser()) {
            admin.login("data-admin");
            var csrf = admin.csrf();
            admin.get("/cockpit/side-metrics", ApiCode.NOT_FOUND);
            admin.get("/admin/dashboards/city-operations/draft", ApiCode.NOT_FOUND);
            admin.post("/admin/dashboards/city-operations/releases", "{}", csrf, ApiCode.NOT_FOUND);
            admin.post("/dashboard-reviews/city-operations", "{}", csrf, ApiCode.NOT_FOUND);
            admin.post("/auth/demo-session", persona("reviewer"), csrf, ApiCode.INVALID_REQUEST);
        }
    }

    @Test
    void publicTopicsExposeOnlyFixedAggregateDefinitionsAndMatchingSnapshots() throws Exception {
        try (var browser = new Browser()) {
            for (String topic : List.of("population", "hotline", "water")) {
                String path = "/cockpit/topics/" + topic;
                JsonNode manifest = browser.get(path + "/manifest", ApiCode.OK);
                String release = manifest.path("releaseId").asString();
                JsonNode snapshot = browser.get(path + "/snapshot?releaseId=" + release, ApiCode.OK);
                assertThat(manifest.path("theme").asString()).isEqualTo(topic);
                assertThat(snapshot.path("quality").asString()).isEqualTo("SIMULATED");
                assertThat(snapshot.path("releaseId").asString()).isEqualTo(release);
                assertThat(snapshot.path("results").size()).isEqualTo(manifest.path("components").size());
                browser.get(path + "/snapshot?releaseId=previous-release", ApiCode.RELEASE_CONFLICT);
                browser.get(path + "/snapshot?releaseId=INVALID", ApiCode.INVALID_REQUEST);
            }
            browser.get("/cockpit/topics/" + CITY + "/manifest", ApiCode.PROJECT_NOT_FOUND);
            browser.get("/cockpit/topics/" + SERVICES + "/snapshot?releaseId=services-release-1", ApiCode.PROJECT_NOT_FOUND);
            browser.get(manifestPath(CITY), ApiCode.AUTH_REQUIRED);
        }
    }

    @Test
    void hotlineAggregatesReconcileAcrossDistrictTownAndVillage() throws Exception {
        try (var browser = new Browser()) {
            JsonNode district = browser.get("/hotline/overview?month=2026-10", ApiCode.OK);
            assertThat(district.path("quality").asString()).isEqualTo("SIMULATED");
            assertThat(district.path("month").asString()).isEqualTo("2026-10");
            assertThat(district.path("snapshotOn").asString()).isEqualTo("2026-10-24");
            assertThat(district.path("trend").size()).isGreaterThanOrEqualTo(10);
            assertThat(district.path("areas").size()).isEqualTo(13);
            JsonNode totals = district.path("totals");
            assertThat(totals.path("received").asInt()).isEqualTo(2460);
            assertThat(totals.path("closed").asInt()).isEqualTo(2381);
            assertThat(totals.path("due").asInt()).isEqualTo(44);
            assertThat(totals.path("late").asInt()).isEqualTo(35);
            assertThat(totals.path("unassigned").asInt()).isEqualTo(25);

            int townTotal = 0;
            for (JsonNode area : district.path("areas")) {
                townTotal += area.path("received").asInt();
            }
            assertThat(townTotal).isEqualTo(totals.path("received").asInt());
            JsonNode town = browser.get("/hotline/overview?areaId=datai&month=2026-10", ApiCode.OK);
            JsonNode village = browser.get("/hotline/overview?areaId=datai-qianjuntai&month=2026-10", ApiCode.OK);
            JsonNode neighbour = browser.get("/hotline/overview?areaId=datai-muchengjian&month=2026-10", ApiCode.OK);
            assertThat(village.path("area").path("parentId").asString()).isEqualTo("datai");
            assertThat(village.path("areas").size()).isZero();
            assertThat(town.path("totals").path("received").asInt()).isEqualTo(66)
                    .isEqualTo(village.path("totals").path("received").asInt()
                            + neighbour.path("totals").path("received").asInt());

            JsonNode analysis = browser.get("/hotline/analysis?areaId=datai-qianjuntai&month=2026-10", ApiCode.OK);
            assertThat(analysis.path("totals")).isEqualTo(village.path("totals"));
            assertThat(ids(analysis.path("findings")))
                    .containsExactly("top-category", "month-change", "deadline-watch", "dispatch-watch");
            JsonNode semantics = browser.get("/hotline/semantics", ApiCode.OK);
            assertThat(ids(semantics.path("metrics"))).contains("received", "closedRate", "receivedMoM");
            List<String> ticketColumns = new ArrayList<>();
            for (JsonNode field : semantics.path("fields")) {
                if (field.path("table").asString().equals("hotline_ticket")) {
                    ticketColumns.add(field.path("column").asString());
                    if (field.path("column").asString().equals("area_id")) {
                        assertThat(field.path("reference").path("table").asString()).isEqualTo("hotline_area");
                    }
                    if (field.path("column").asString().equals("ticket_status")) {
                        assertThat(field.path("allowedValues").size()).isEqualTo(3);
                    }
                }
            }
            assertThat(ticketColumns).containsExactly("ticket_id", "month_start", "area_id", "town_id", "category_id",
                    "ticket_status", "attention_lane", "title", "opened_on", "assigned_on", "processed_on", "closed_on",
                    "elapsed_days", "note");
        }
    }

    @Test
    void hotlinePagesFilterAndExposeRecordedWorkflow() throws Exception {
        try (var browser = new Browser()) {
            String query = "/hotline/tickets?areaId=datai&month=2026-10&lane=late&size=1";
            JsonNode first = browser.get(query, ApiCode.OK);
            JsonNode second = browser.get(query + "&page=1", ApiCode.OK);
            JsonNode end = browser.get(query + "&page=2", ApiCode.OK);
            assertThat(first.path("total").asInt()).isEqualTo(2);
            assertThat(first.path("items").size()).isEqualTo(1);
            assertThat(second.path("total").asInt()).isEqualTo(2);
            assertThat(end.path("items").size()).isZero();
            JsonNode ticket = first.path("items").get(0);
            assertThat(ticket.path("elapsedDays").asInt()).isGreaterThanOrEqualTo(7);
            assertThat(ticket.path("townId").asString()).isEqualTo("datai");
            assertThat(ticket.path("id").asString()).isNotEqualTo(second.path("items").get(0).path("id").asString());
            String detailsPath = "/hotline/tickets/" + ticket.path("id").asString();
            JsonNode detail = browser.get(detailsPath + "?areaId=datai&month=2026-10", ApiCode.OK);
            assertThat(detail.path("title").asString()).isEqualTo(ticket.path("title").asString());
            assertThat(browser.get(detailsPath, ApiCode.OK)).isEqualTo(detail);
            browser.get(detailsPath + "?areaId=zhaitang&month=2026-10", ApiCode.NOT_FOUND);
            browser.get(detailsPath + "?areaId=datai&month=2026-09", ApiCode.NOT_FOUND);
            assertThat(detail.path("steps").size()).isEqualTo(4);
            assertThat(detail.path("steps").get(0).path("on").asString()).isEqualTo(ticket.path("openedOn").asString());
            assertThat(detail.path("steps").get(3).path("state").asString()).isEqualTo("pending");
            JsonNode byCategory = browser.get("/hotline/tickets?category=" + ticket.path("categoryId").asString(),
                    ApiCode.OK);
            for (JsonNode item : byCategory.path("items")) {
                assertThat(item.path("categoryId")).isEqualTo(ticket.path("categoryId"));
            }
            browser.get("/hotline/tickets?size=101", ApiCode.INVALID_REQUEST);
            browser.get("/hotline/tickets?page=-1", ApiCode.INVALID_REQUEST);
            browser.get("/hotline/tickets?lane=unknown", ApiCode.INVALID_REQUEST);
            browser.get("/hotline/tickets?category=unknown", ApiCode.INVALID_REQUEST);
            browser.get("/hotline/overview?month=" + java.time.YearMonth.now(java.time.ZoneId.of("Asia/Shanghai")).plusMonths(1), ApiCode.INVALID_REQUEST);
            browser.get("/hotline/overview?areaId=unlisted", ApiCode.NOT_FOUND);
            browser.get("/hotline/tickets/HL-202610-99999", ApiCode.NOT_FOUND);
        }
    }

    @Test
    void hotlineDefaultsAgreeOnTheLatestAvailableSnapshot() throws Exception {
        try (var browser = new Browser()) {
            JsonNode overview = browser.get("/hotline/overview?areaId=datai", ApiCode.OK);
            String latest = overview.path("month").asString();
            JsonNode trend = overview.path("trend");
            assertThat(trend.get(trend.size() - 1).path("month").asString()).isEqualTo(latest);
            assertThat(overview.path("totals").path("received").asInt()).isPositive();
            var today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
            assertThat(java.time.LocalDate.parse(overview.path("snapshotOn").asString())).isBeforeOrEqualTo(today);
            if (!today.isBefore(java.time.LocalDate.of(2026, 11, 1))) {
                assertThat(latest).isEqualTo(java.time.YearMonth.from(today).toString());
            }
            JsonNode tickets = browser.get("/hotline/tickets?areaId=datai&size=1", ApiCode.OK);
            JsonNode analysis = browser.get("/hotline/analysis?areaId=datai", ApiCode.OK);
            assertThat(tickets.path("month").asString()).isEqualTo(latest);
            assertThat(tickets.path("total").asInt()).isEqualTo(overview.path("totals").path("received").asInt());
            assertThat(analysis.path("month").asString()).isEqualTo(latest);
            assertThat(analysis.path("totals")).isEqualTo(overview.path("totals"));
        }
    }

    @Test
    void requiresCsrfHeaderAndDataAdminBeforeAcceptingCsv() throws Exception {
        try (var browser = new Browser()) {
            browser.uploadCsv(null, ApiCode.CSRF_INVALID);
            browser.uploadCsv(browser.csrf(), ApiCode.AUTH_REQUIRED);
            browser.login("district");
            browser.uploadCsv(browser.csrf(), ApiCode.ACCESS_DENIED);
            browser.login("data-admin");
            browser.uploadCsv(null, ApiCode.CSRF_INVALID);
            JsonNode asset = browser.uploadCsv(browser.csrf(), ApiCode.OK);
            assertThat(asset.path("fileName").asString()).isEqualTo("observations.csv");
        }
    }

    @Test
    void returnsPublishedManifestAndSyntheticBatch() throws Exception {
        try (var browser = new Browser()) {
            JsonNode identity = browser.login("district");
            assertIdentity(identity, CITY, "/");
            assertThat(browser.get("/me", ApiCode.OK)).isEqualTo(identity);
            assertThat(ids(browser.get("/projects/recommendations", ApiCode.OK)))
                    .containsExactly(CITY, SERVICES, "population", "hotline", "water");

            JsonNode manifest = browser.get(manifestPath(CITY), ApiCode.OK);
            assertThat(manifest.path("schemaVersion").asInt()).isEqualTo(1);
            assertThat(manifest.path("projectId").asString()).isEqualTo(CITY);
            assertThat(manifest.path("releaseId").asString()).isEqualTo("city-release-1");
            assertThat(manifest.path("canvas").isObject()).isTrue();
            assertThat(manifest.path("components").isArray()).isTrue();
            assertThat(manifest.path("components").size()).isPositive();
            JsonNode component = manifest.path("components").get(0);
            assertThat(component.path("id").asString()).isNotBlank();
            String batchRequest = batchPayload(manifest.path("releaseId").asString(), component.path("id").asString());

            browser.post(queryPath(CITY), batchRequest, null, ApiCode.CSRF_INVALID);
            Csrf csrf = browser.csrf();
            JsonNode batch = browser.post(queryPath(CITY), batchRequest, csrf, ApiCode.OK);
            assertThat(batch.path("projectId").asString()).isEqualTo(CITY);
            assertThat(batch.path("releaseId").asString()).isEqualTo("city-release-1");
            assertThat(batch.path("snapshotId").asString()).isNotBlank();
            assertThat(Instant.parse(batch.path("updatedAt").asString())).isNotNull();
            assertThat(batch.path("quality").asString()).isEqualTo("SIMULATED");
            assertThat(batch.path("results").size()).isEqualTo(1);
            JsonNode result = batch.path("results").get(0);
            assertThat(result.path("componentId")).isEqualTo(component.path("id"));
            assertThat(result.path("metricId")).isEqualTo(component.path("metricId"));
            assertThat(result.path("unit")).isEqualTo(component.path("unit"));
            assertThat(result.path("value").isNumber() || result.path("points").size() > 0).isTrue();

            browser.get(manifestPath("missing-project"), ApiCode.PROJECT_NOT_FOUND);
            browser.post(queryPath(CITY), "{\"releaseId\":\"city-release-1\",\"componentIds\":[]}", csrf, ApiCode.INVALID_REQUEST);
            browser.post(queryPath(CITY), batchPayload("stale-release", component.path("id").asString()), csrf, ApiCode.RELEASE_CONFLICT);
        }
    }

    @Test
    void rotatesSessionOnRoleSwitchAndDeniesOldSession() throws Exception {
        try (var browser = new Browser()) {
            JsonNode district = browser.login("district");
            String districtSession = browser.sessionId();
            JsonNode service = browser.login("service");
            String serviceSession = browser.sessionId();
            assertThat(serviceSession.equals(districtSession)).as("session ID must rotate on role switch").isFalse();
            assertIdentity(service, SERVICES, "/play/public-services");
            assertThat(service.path("id")).isNotEqualTo(district.path("id"));
            assertThat(browser.get("/me", ApiCode.OK)).isEqualTo(service);
            assertThat(ids(browser.get("/projects/recommendations", ApiCode.OK))).containsExactly(SERVICES);
            assertThat(browser.get(manifestPath(SERVICES), ApiCode.OK).path("releaseId").asString()).isEqualTo("services-release-1");
            browser.get(manifestPath(CITY), ApiCode.PROJECT_NOT_FOUND);

            Csrf csrf = browser.csrf();
            browser.post(queryPath(CITY), batchPayload("city-release-1", "example-component"), csrf, ApiCode.PROJECT_NOT_FOUND);
            assertOldSessionRejected(districtSession);

            assertThat(browser.post("/auth/logout", null, csrf, ApiCode.OK).isNull()).isTrue();
            browser.get("/me", ApiCode.AUTH_REQUIRED);
            assertOldSessionRejected(serviceSession);
        }
    }

    @Test
    void keepsManagementAndDisplayIdentitiesAndCsrfTokensSeparateInOneBrowser() throws Exception {
        String management = "management";
        String admin = "/admin/sources";
        try (var browser = new Browser()) {
            JsonNode service = browser.login("service");
            String initialSession = browser.sessionId();
            Csrf displayToken = browser.csrf();
            var manifest = browser.get(manifestPath(SERVICES), ApiCode.OK);
            String batch = batchPayload(manifest.path("releaseId").asString(),
                    manifest.path("components").get(0).path("id").asString());

            browser.get("/me", management, ApiCode.AUTH_REQUIRED);
            browser.post("/auth/demo-session", persona("data-admin"), displayToken, management, ApiCode.CSRF_INVALID);
            JsonNode manager = browser.login("data-admin", management);
            assertThat(browser.sessionId()).isNotEqualTo(initialSession);
            assertOldSessionRejected(initialSession);
            assertThat(browser.get("/me", management, ApiCode.OK)).isEqualTo(manager);
            assertThat(browser.get("/me", ApiCode.OK)).isEqualTo(service);
            browser.get(admin, management, ApiCode.OK);
            browser.get(admin, ApiCode.ACCESS_DENIED);
            browser.get(manifestPath(SERVICES), management, ApiCode.PROJECT_NOT_FOUND);
            browser.post(queryPath(SERVICES), batch, displayToken, ApiCode.OK);

            Csrf managerToken = browser.csrf(management);
            browser.post("/auth/logout", null, displayToken, management, ApiCode.CSRF_INVALID);
            browser.post("/auth/logout", null, displayToken, ApiCode.OK);
            browser.get("/me", ApiCode.AUTH_REQUIRED);
            browser.get(admin, management, ApiCode.OK);
            assertThat(browser.login("service")).isEqualTo(service);
            browser.post("/auth/logout", null, managerToken, management, ApiCode.OK);
            browser.get("/me", management, ApiCode.AUTH_REQUIRED);
            assertThat(browser.get("/me", ApiCode.OK)).isEqualTo(service);
            browser.get(manifestPath(SERVICES), ApiCode.OK);
            browser.post("/auth/demo-session", persona("data-admin"), managerToken, management, ApiCode.CSRF_INVALID);
        }
    }

    @Test
    void servesAnonymousCockpitAcrossThreeLevels() throws Exception {
        try (var browser = new Browser()) {
            JsonNode district = browser.get("/cockpit/areas/mentougou", ApiCode.OK);
            assertArea(district, "mentougou", "district", "mentougou");
            assertThat(district.path("children").size()).isEqualTo(13);
            assertThat(district.path("name").asString()).isEqualTo("门头沟区");

            double districtEvents = 0;
            for (JsonNode townMarker : district.path("children")) {
                String id = townMarker.path("id").asString();
                assertThat(townMarker.path("level").asString()).isEqualTo("town");
                assertThat(townMarker.path("x").asDouble()).isBetween(-1.0, 1.0);
                assertThat(townMarker.path("z").asDouble()).isBetween(-1.0, 1.0);
                JsonNode town = browser.get("/cockpit/areas/" + id, ApiCode.OK);
                assertArea(town, id, "town", "mentougou", id);
                assertThat(town.path("children").size()).isEqualTo(2);
                districtEvents += town.path("metrics").get(0).path("value").asDouble();
            }
            assertThat(district.path("metrics").get(0).path("value").asDouble()).isEqualTo(districtEvents);

            JsonNode village = browser.get("/cockpit/areas/miaofengshan-longjiazhuang", ApiCode.OK);
            assertArea(village, "miaofengshan-longjiazhuang", "village",
                    "mentougou", "miaofengshan", "miaofengshan-longjiazhuang");
            assertThat(village.path("name").asString()).isEqualTo("陇驾庄村");
            assertThat(village.path("children").isArray()).isTrue();
            assertThat(village.path("children").size()).isZero();
            browser.get("/cockpit/areas/unknown", ApiCode.NOT_FOUND);
            browser.get("/me", ApiCode.AUTH_REQUIRED);
        }
    }

    @Test
    void exposesCanonicalCockpitLocationHierarchyToAnonymousUsers() throws Exception {
        try (var browser = new Browser()) {
            JsonNode locations = browser.get("/cockpit/locations", ApiCode.OK);
            List<String> regionIds = ids(locations);
            assertThat(regionIds).hasSize(40).doesNotHaveDuplicates().startsWith("mentougou");

            JsonNode root = locations.get(0);
            assertThat(root.path("name").asString()).isEqualTo("门头沟区");
            assertThat(root.path("level").asString()).isEqualTo("district");
            assertThat(root.path("parentId").isNull()).isTrue();

            assertThat(regionIds).contains("datai", "datai-qianjuntai");
            JsonNode street = locations.get(regionIds.indexOf("datai"));
            assertThat(street.path("name").asString()).isEqualTo("大台街道");
            assertThat(street.path("level").asString()).isEqualTo("town");
            assertThat(street.path("parentId").asString()).isEqualTo("mentougou");

            JsonNode village = locations.get(regionIds.indexOf("datai-qianjuntai"));
            assertThat(village.size()).isEqualTo(4);
            assertThat(village.path("name").asString()).isEqualTo("千军台社区");
            assertThat(village.path("level").asString()).isEqualTo("village");
            assertThat(village.path("parentId").asString()).isEqualTo("datai");
            browser.get("/me", ApiCode.AUTH_REQUIRED);
        }
    }

    private static void assertArea(JsonNode snapshot, String areaId, String level, String... path) {
        assertThat(snapshot.path("id").asString()).isEqualTo(areaId);
        assertThat(snapshot.path("level").asString()).isEqualTo(level);
        assertThat(snapshot.path("quality").asString()).isEqualTo("SIMULATED");
        assertThat(Instant.parse(snapshot.path("updatedAt").asString())).isNotNull();
        assertThat(ids(snapshot.path("breadcrumbs"))).containsExactly(path);
        assertThat(ids(snapshot.path("metrics"))).containsExactly(
                "governance-events", "completion-rate", "service-cases", "active-alerts",
                "air-quality-rate", "road-traffic", "tourism-visits", "active-projects");
        assertThat(snapshot.path("trend").size()).isEqualTo(7);
        double distributionSum = 0;
        for (JsonNode point : snapshot.path("distribution")) {
            distributionSum += point.path("value").asDouble();
        }
        assertThat(distributionSum).isEqualTo(snapshot.path("metrics").get(0).path("value").asDouble());
        for (JsonNode metric : snapshot.path("metrics")) {
            assertThat(metric.path("value").isNumber()).isTrue();
            assertThat(metric.path("delta").isNumber()).isTrue();
            assertThat(metric.path("series").size()).isEqualTo(7);
            assertThat(metric.path("series").get(6)).isEqualTo(metric.path("value"));
        }
        for (JsonNode signal : snapshot.path("signals")) {
            assertThat(Instant.parse(signal.path("time").asString())).isNotNull();
        }
    }

    private static void assertIdentity(JsonNode identity, String projectId, String landingPath) {
        assertThat(identity.path("id").asString()).isNotBlank();
        assertThat(identity.path("displayName").asString()).isNotBlank();
        assertThat(identity.path("department").asString()).isNotBlank();
        assertThat(identity.path("roles").size()).isPositive();
        assertThat(identity.path("permissions").size()).isPositive();
        assertThat(identity.path("mode").asString()).isEqualTo("demo");
        assertThat(identity.path("defaultProjectId").asString()).isEqualTo(projectId);
        assertThat(identity.path("landingPath").asString()).isEqualTo(landingPath);
    }

    private static List<String> ids(JsonNode projects) {
        assertThat(projects.isArray()).isTrue();
        List<String> ids = new ArrayList<>();
        for (JsonNode project : projects) {
            ids.add(project.path("id").asString());
        }
        return ids;
    }

    private static String persona(String name) {
        return JSON.createObjectNode().put("persona", name).toString();
    }

    private static String batchPayload(String releaseId, String componentId) {
        var payload = JSON.createObjectNode().put("releaseId", releaseId);
        payload.putArray("componentIds").add(componentId);
        return payload.toString();
    }

    private static String manifestPath(String projectId) {
        return "/playback/" + projectId + "/manifest";
    }

    private static String queryPath(String projectId) {
        return "/playback/" + projectId + "/component-queries";
    }

    private HttpRequest.Builder request(String path) {
        return requestOnPort(port, "/api/v1" + path);
    }

    private static HttpRequest.Builder requestOnPort(int listenerPort, String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + listenerPort + path))
                .timeout(Duration.ofSeconds(10))
                .header("Accept", "application/json");
    }

    private void assertOldSessionRejected(String sessionId) throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            var previousSession = request("/me").header("Cookie", "DISTRICT_SESSION=" + sessionId).GET().build();
            exchange(client, previousSession, ApiCode.AUTH_REQUIRED);
        }
    }

    private static JsonNode exchange(HttpClient client, HttpRequest request, ApiCode expected) throws Exception {
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as("%s %s HTTP status", request.method(), request.uri().getPath())
                .isEqualTo(expected.httpStatus());
        assertThat(response.headers().firstValue("X-Request-Id").orElse("")).isNotBlank();
        assertThat(response.headers().firstValue("Cache-Control").orElse("")).isEqualTo("no-store");
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json");

        JsonNode envelope = JSON.readTree(response.body());
        assertThat(envelope.isObject()).isTrue();
        assertThat(envelope.size()).isEqualTo(3);
        assertThat(envelope.has("data")).isTrue();
        assertThat(envelope.path("message").asString()).isNotBlank();
        assertThat(envelope.path("code").isString()).isTrue();
        assertThat(envelope.path("code").asString()).isEqualTo(expected.code());
        return envelope.get("data");
    }

    private record Csrf(String headerName, String token) {
    }

    private final class Browser implements AutoCloseable {

        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER);
        private final HttpClient client = HttpClient.newBuilder()
                .cookieHandler(cookies)
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        private JsonNode get(String path, ApiCode expected) throws Exception {
            return get(path, null, expected);
        }

        private JsonNode get(String path, String workspace, ApiCode expected) throws Exception {
            return exchange(client, scopedRequest(path, workspace).GET().build(), expected);
        }

        private JsonNode post(String path, String payload, Csrf csrf, ApiCode expected) throws Exception {
            return post(path, payload, csrf, null, expected);
        }

        private JsonNode post(String path, String payload, Csrf csrf, String workspace, ApiCode expected) throws Exception {
            var builder = scopedRequest(path, workspace);
            if (csrf != null) {
                builder.header(csrf.headerName(), csrf.token());
            }
            if (payload != null) {
                builder.header("Content-Type", "application/json");
                return exchange(client, builder.POST(HttpRequest.BodyPublishers.ofString(payload)).build(), expected);
            }
            return exchange(client, builder.POST(HttpRequest.BodyPublishers.noBody()).build(), expected);
        }

        private HttpRequest.Builder scopedRequest(String path, String workspace) {
            var builder = request(path);
            return workspace == null ? builder : builder.header(WorkspaceSecurity.WORKSPACE_HEADER, workspace);
        }

        private JsonNode uploadCsv(Csrf csrf, ApiCode expected) throws Exception {
            var builder = request("/admin/source-assets").header("Content-Type", "multipart/form-data; boundary=fixture");
            if (csrf != null) {
                builder.header(csrf.headerName(), csrf.token());
            }
            String body = "--fixture\r\nContent-Disposition: form-data; name=\"file\"; filename=\"observations.csv\""
                    + "\r\nContent-Type: text/csv\r\n\r\nregion,date,measure,value\r\n"
                    + "dayu,2026-11-23,events,10\r\n--fixture--\r\n";
            return exchange(client, builder.POST(HttpRequest.BodyPublishers.ofString(body)).build(), expected);
        }

        private Csrf csrf() throws Exception {
            return csrf(null);
        }

        private Csrf csrf(String workspace) throws Exception {
            JsonNode csrf = get("/auth/csrf", workspace, ApiCode.OK);
            String headerName = csrf.path("headerName").asString();
            String token = csrf.path("token").asString();
            assertThat(headerName).matches("X-[A-Za-z0-9-]+");
            assertThat(!token.isBlank()).as("CSRF token must be present").isTrue();
            return new Csrf(headerName, token);
        }

        private JsonNode login(String personaName) throws Exception {
            return login(personaName, null);
        }

        private JsonNode login(String personaName, String workspace) throws Exception {
            return post("/auth/demo-session", persona(personaName), csrf(workspace), workspace, ApiCode.OK);
        }

        private String sessionId() {
            return cookies.getCookieStore().getCookies().stream()
                    .filter(cookie -> cookie.getName().equals("DISTRICT_SESSION"))
                    .findFirst()
                    .map(HttpCookie::getValue)
                    .orElseThrow(() -> new AssertionError("DISTRICT_SESSION was not returned"));
        }

        @Override
        public void close() {
            client.close();
        }
    }
}
