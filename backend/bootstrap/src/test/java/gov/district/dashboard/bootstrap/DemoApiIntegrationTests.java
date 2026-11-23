package gov.district.dashboard.bootstrap;

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
            assertThat(ids(browser.get("/projects/recommendations", ApiCode.OK))).containsExactly(CITY, SERVICES);

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
            return exchange(client, request(path).GET().build(), expected);
        }

        private JsonNode post(String path, String payload, Csrf csrf, ApiCode expected) throws Exception {
            var builder = request(path);
            if (csrf != null) {
                builder.header(csrf.headerName(), csrf.token());
            }
            if (payload != null) {
                builder.header("Content-Type", "application/json");
                return exchange(client, builder.POST(HttpRequest.BodyPublishers.ofString(payload)).build(), expected);
            }
            return exchange(client, builder.POST(HttpRequest.BodyPublishers.noBody()).build(), expected);
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
            JsonNode csrf = get("/auth/csrf", ApiCode.OK);
            String headerName = csrf.path("headerName").asString();
            String token = csrf.path("token").asString();
            assertThat(headerName).matches("X-[A-Za-z0-9-]+");
            assertThat(!token.isBlank()).as("CSRF token must be present").isTrue();
            return new Csrf(headerName, token);
        }

        private JsonNode login(String personaName) throws Exception {
            return post("/auth/demo-session", persona(personaName), csrf(), ApiCode.OK);
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
