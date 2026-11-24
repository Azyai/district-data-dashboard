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
import tools.jackson.databind.node.ObjectNode;

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
    void publishesOnlyValidPublicSideMetricsWithAdminAndRevisionChecks() throws Exception {
        String layout = "/cockpit/side-metrics";
        String settings = "/admin/cockpit/side-metrics";
        try (var admin = new Browser(); var viewer = new Browser()) {
            JsonNode initial = viewer.get(layout, ApiCode.OK);
            long revision = initial.path("revision").asLong();
            String match = "\"" + revision + "\"";
            assertThat(initial.path("left").size()).isEqualTo(2);
            JsonNode edited = JSON.readTree("""
                    {"left":["active-projects"],"right":["active-alerts","tourism-visits"]}
                    """);
            admin.putDraft(settings, edited, match, admin.csrf(), ApiCode.AUTH_REQUIRED);
            viewer.login("district");
            viewer.putDraft(settings, edited, match, viewer.csrf(), ApiCode.ACCESS_DENIED);
            admin.login("data-admin");
            admin.putDraft(settings, edited, match, null, ApiCode.CSRF_INVALID);
            Csrf csrf = admin.csrf();
            admin.putDraft(settings, edited, null, csrf, ApiCode.INVALID_REQUEST);
            for (String left : List.of("[]", "[\"unknown\"]", "[\"active-alerts\"]", "[\"active-projects\",\"active-projects\"]",
                    "[\"governance-events\",\"service-cases\",\"active-projects\",\"road-traffic\"]")) {
                JsonNode invalid = JSON.readTree("{\"left\":" + left + ",\"right\":[\"active-alerts\"]}");
                admin.putDraft(settings, invalid, match, csrf, ApiCode.INVALID_REQUEST);
            }
            assertThat(viewer.get(layout, ApiCode.OK)).isEqualTo(initial);
            JsonNode saved = admin.putDraft(settings, edited, match, csrf, ApiCode.OK);
            assertThat(saved.path("revision").asLong()).isEqualTo(revision + 1);
            assertThat(saved.path("left")).isEqualTo(edited.path("left"));
            assertThat(saved.path("right")).isEqualTo(edited.path("right"));
            admin.putDraft(settings, edited, match, csrf, ApiCode.VERSION_CONFLICT);
            assertThat(viewer.get(layout, ApiCode.OK)).isEqualTo(saved);
        }
    }

    @Test
    void publicTopicsExposeOnlyActiveAggregateTemplatesAndMatchingSnapshots() throws Exception {
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
                browser.get(draftPath(topic), ApiCode.AUTH_REQUIRED);
            }
            browser.get("/cockpit/topics/" + CITY + "/manifest", ApiCode.PROJECT_NOT_FOUND);
            browser.get("/cockpit/topics/" + SERVICES + "/snapshot?releaseId=services-release-1", ApiCode.PROJECT_NOT_FOUND);
            browser.get(manifestPath(CITY), ApiCode.AUTH_REQUIRED);
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
    void protectsDashboardDraftsAndPreservesPublishedPlayback() throws Exception {
        String path = draftPath(CITY);
        try (var admin = new Browser(); var viewer = new Browser()) {
            admin.get(path, ApiCode.AUTH_REQUIRED);
            viewer.login("district");
            viewer.get(path, ApiCode.ACCESS_DENIED);
            JsonNode published = viewer.get(manifestPath(CITY), ApiCode.OK);
            admin.login("data-admin");
            admin.get(draftPath("missing-project"), ApiCode.PROJECT_NOT_FOUND);

            JsonNode initial = admin.get(path, ApiCode.OK);
            assertThat(initial.path("revision").asInt()).isZero();
            assertThat(initial.path("template")).isEqualTo(published);
            assertThat(initial.path("components")).isEqualTo(published.path("components"));
            assertThat(initial.path("snapshot").path("results").size()).isEqualTo(initial.path("components").size());

            var edited = JSON.createObjectNode();
            var components = edited.putArray("components");
            var first = (ObjectNode) initial.path("components").get(0).deepCopy();
            first.put("title", "指挥席观察指标");
            ((ObjectNode) first.path("geometry")).put("x", 71);
            components.add(first);
            var csrf = admin.csrf();
            admin.putDraft(path, edited, "\"0\"", null, ApiCode.CSRF_INVALID);
            admin.putDraft(path, edited, null, csrf, ApiCode.INVALID_REQUEST);
            admin.putDraft(path, edited, "0", csrf, ApiCode.INVALID_REQUEST);

            first.put("metricId", "received-cases");
            admin.putDraft(path, edited, "\"0\"", csrf, ApiCode.INVALID_REQUEST);
            first.put("metricId", published.path("components").get(0).path("metricId").asString());
            ((ObjectNode) first.path("geometry")).put("width", 1920);
            admin.putDraft(path, edited, "\"0\"", csrf, ApiCode.INVALID_REQUEST);
            ((ObjectNode) first.path("geometry")).put("width", 400);
            components.add(first.deepCopy());
            admin.putDraft(path, edited, "\"0\"", csrf, ApiCode.INVALID_REQUEST);
            components.remove(1);
            assertThat(admin.get(path, ApiCode.OK).path("revision").asInt()).isZero();

            JsonNode saved = admin.putDraft(path, edited, "\"0\"", csrf, ApiCode.OK);
            assertThat(saved.path("revision").asInt()).isEqualTo(1);
            assertThat(saved.path("components")).isEqualTo(components);
            admin.putDraft(path, edited, "\"0\"", csrf, ApiCode.VERSION_CONFLICT);
            assertThat(admin.get(path, ApiCode.OK).path("components")).isEqualTo(components);
            assertThat(viewer.get(manifestPath(CITY), ApiCode.OK)).isEqualTo(published);

            components.removeAll();
            JsonNode cleared = admin.putDraft(path, edited, "\"1\"", csrf, ApiCode.OK);
            assertThat(cleared.path("revision").asInt()).isEqualTo(2);
            assertThat(admin.get(path, ApiCode.OK).path("components").isEmpty()).isTrue();
        }
    }

    @Test
    void allowsOnlyOneConcurrentFirstDraftSave() throws Exception {
        String path = draftPath(SERVICES);
        try (var admin = new Browser()) {
            admin.login("data-admin");
            JsonNode initial = admin.get(path, ApiCode.OK);
            var draft = JSON.createObjectNode().set("components", initial.path("components"));
            var csrf = admin.csrf();
            var first = admin.client.sendAsync(admin.draftRequest(path, draft, "\"0\"", csrf),
                    HttpResponse.BodyHandlers.ofString());
            var second = admin.client.sendAsync(admin.draftRequest(path, draft, "\"0\"", csrf),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(List.of(first.get().statusCode(), second.get().statusCode())).containsExactlyInAnyOrder(200, 409);
            assertThat(admin.get(path, ApiCode.OK).path("revision").asInt()).isEqualTo(1);
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

    private static String draftPath(String projectId) {
        return "/admin/dashboards/" + projectId + "/draft";
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

        private JsonNode putDraft(String path, JsonNode payload, String version, Csrf csrf, ApiCode expected)
                throws Exception {
            return exchange(client, draftRequest(path, payload, version, csrf), expected);
        }

        private HttpRequest draftRequest(String path, JsonNode payload, String version, Csrf csrf) {
            var builder = request(path).header("Content-Type", "application/json");
            if (version != null) {
                builder.header("If-Match", version);
            }
            if (csrf != null) {
                builder.header(csrf.headerName(), csrf.token());
            }
            return builder.PUT(HttpRequest.BodyPublishers.ofString(payload.toString())).build();
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
