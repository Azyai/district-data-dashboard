package gov.district.dashboard.bootstrap;

import gov.district.dashboard.platform.api.ApiCode;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(classes = DistrictDashboardApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "management.server.port=0",
                "spring.datasource.url=jdbc:h2:mem:district_dashboard_release_test;MODE=MySQL;DB_CLOSE_DELAY=-1"
        })
@ActiveProfiles("demo")
class DashboardReleaseIntegrationTests {

    private static final String DRAFT = "/admin/dashboards/city-operations/draft";
    private static final String RELEASES = "/admin/dashboards/city-operations/releases";
    private static final String REVIEWS = "/dashboard-reviews/city-operations";
    private static final String MANIFEST = "/playback/city-operations/manifest";
    private static final String QUERY = "/playback/city-operations/component-queries";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @LocalServerPort
    int port;

    @Test
    void reviewsFrozenDraftsAndRollsBackWithNewPlaybackReleaseIds() throws Exception {
        try (var author = new Browser(); var reviewer = new Browser(); var viewer = new Browser()) {
            author.get(RELEASES, ApiCode.AUTH_REQUIRED);
            reviewer.get(REVIEWS, ApiCode.AUTH_REQUIRED);
            author.login("data-admin");
            String reviewerId = reviewer.login("reviewer").path("id").asString();
            viewer.login("district");

            author.get(REVIEWS, ApiCode.ACCESS_DENIED);
            author.post(REVIEWS, review(1, 0, "APPROVE", ""), ApiCode.ACCESS_DENIED);
            reviewer.get(DRAFT, ApiCode.ACCESS_DENIED);
            reviewer.post(RELEASES, submission(1), ApiCode.ACCESS_DENIED);
            viewer.get(REVIEWS + "/1", ApiCode.ACCESS_DENIED);
            viewer.get(RELEASES, ApiCode.ACCESS_DENIED);
            author.post(RELEASES, submission(1), ApiCode.VERSION_CONFLICT);

            JsonNode baseline = viewer.get(MANIFEST, ApiCode.OK);
            String baselineId = baseline.path("releaseId").asString();
            ObjectNode first = layout(baseline, "reviewed-first", "第一次送审");
            ObjectNode second = layout(baseline, "published-second", "第二次送审");
            ObjectNode third = layout(baseline, "published-third", "第三次送审");

            var firstCard = (ObjectNode) first.path("components").get(0);
            firstCard.put("chartStyle", "network");
            author.save(first, 0, ApiCode.INVALID_REQUEST);
            firstCard.remove("chartStyle");

            addCategoryChart(second, baseline, "radar");
            addCategoryChart(third, baseline, "ring");

            assertThat(author.save(first, 0).path("revision").asInt()).isEqualTo(1);

            HttpRequest submitFirst = author.postRequest(RELEASES, submission(1));
            var firstSubmission = author.client.sendAsync(submitFirst, HttpResponse.BodyHandlers.ofString());
            var secondSubmission = author.client.sendAsync(submitFirst, HttpResponse.BodyHandlers.ofString());
            for (var response : List.of(firstSubmission, secondSubmission)) {
                JsonNode submitted = data(response.get(15, TimeUnit.SECONDS), ApiCode.OK);
                assertThat(submitted.path("releases").size()).isEqualTo(1);
                assertThat(submitted.path("releases").get(0).path("status").asString()).isEqualTo("PENDING");
                assertThat(submitted.path("serial").asLong()).isZero();
                assertThat(submitted.path("activeRevision").isNull()).isTrue();
            }

            assertThat(author.save(second, 1).path("revision").asInt()).isEqualTo(2);
            author.post(RELEASES, submission(2), ApiCode.VERSION_CONFLICT);
            JsonNode frozenFirst = reviewer.get(REVIEWS + "/1", ApiCode.OK);
            assertThat(frozenFirst.path("revision").asInt()).isEqualTo(1);
            assertThat(frozenFirst.path("components")).isEqualTo(first.path("components"));
            assertThat(frozenFirst.path("snapshot").path("results").isEmpty()).isFalse();
            assertThat(viewer.get(MANIFEST, ApiCode.OK)).isEqualTo(baseline);

            reviewer.post(REVIEWS, review(1, 0, "RETURN", "  "), ApiCode.INVALID_REQUEST);
            JsonNode returned = reviewer.post(REVIEWS, review(1, 0, "RETURN", "补充指标说明"), ApiCode.OK);
            JsonNode returnedRow = returned.path("releases").get(0);
            assertThat(returnedRow.path("status").asString()).isEqualTo("RETURNED");
            assertThat(returnedRow.path("reviewNote").asString()).isEqualTo("补充指标说明");
            assertThat(returnedRow.path("reviewedBy").asString()).isEqualTo(reviewerId);
            assertThat(returned.path("serial").asLong()).isZero();
            reviewer.post(REVIEWS, review(1, 0, "APPROVE", ""), ApiCode.VERSION_CONFLICT);

            author.post(RELEASES, submission(2), ApiCode.OK);
            assertThat(author.save(third, 2).path("revision").asInt()).isEqualTo(3);
            assertThat(reviewer.get(REVIEWS + "/2", ApiCode.OK).path("components")).isEqualTo(second.path("components"));
            assertThat(viewer.get(MANIFEST, ApiCode.OK)).isEqualTo(baseline);

            JsonNode approval = reviewer.post(REVIEWS, review(2, 0, "APPROVE", "核准"), ApiCode.OK);
            assertThat(approval.path("serial").asLong()).isEqualTo(1);
            assertThat(approval.path("activeRevision").asInt()).isEqualTo(2);
            assertThat(approval.path("releases").get(0).path("status").asString()).isEqualTo("APPROVED");
            JsonNode published = viewer.get(MANIFEST, ApiCode.OK);
            String publishedId = published.path("releaseId").asString();
            assertThat(publishedId).isNotBlank().isNotEqualTo(baselineId);
            assertThat(published.path("components")).isEqualTo(second.path("components"));
            assertThat(published.path("components").get(1).path("chartStyle").asString()).isEqualTo("radar");
            viewer.post(QUERY, batch(baselineId, "accepted-events"), ApiCode.RELEASE_CONFLICT);
            JsonNode publishedBatch = viewer.post(QUERY, batch(publishedId, "published-second"), ApiCode.OK);
            assertThat(publishedBatch.path("releaseId").asString()).isEqualTo(publishedId);
            assertThat(publishedBatch.path("results").get(0).path("componentId").asString()).isEqualTo("published-second");
            assertThat(publishedBatch.path("results").get(0).path("metricId").asString()).isEqualTo("accepted-events");

            author.post(RELEASES, submission(3), ApiCode.OK);
            reviewer.post(REVIEWS, review(3, 1, "APPROVE", ""), ApiCode.OK);
            assertThat(viewer.get(MANIFEST, ApiCode.OK).path("components")).isEqualTo(third.path("components"));
            reviewer.post(REVIEWS, review(2, 1, "ROLLBACK", "回退已审核版本"), ApiCode.VERSION_CONFLICT);

            JsonNode restored = reviewer.post(REVIEWS, review(2, 2, "ROLLBACK", "回退已审核版本"), ApiCode.OK);
            assertThat(restored.path("serial").asLong()).isEqualTo(3);
            assertThat(restored.path("activeRevision").asInt()).isEqualTo(2);
            JsonNode restoredManifest = viewer.get(MANIFEST, ApiCode.OK);
            String restoredId = restoredManifest.path("releaseId").asString();
            assertThat(restoredId).isNotBlank().isNotEqualTo(publishedId);
            assertThat(restoredManifest.path("components")).isEqualTo(second.path("components"));
            viewer.post(QUERY, batch(publishedId, "published-second"), ApiCode.RELEASE_CONFLICT);

            JsonNode reset = reviewer.post(REVIEWS, review(0, 3, "ROLLBACK", "恢复默认模板"), ApiCode.OK);
            assertThat(reset.path("serial").asLong()).isEqualTo(4);
            assertThat(reset.path("activeRevision").isNull()).isTrue();
            JsonNode resetManifest = viewer.get(MANIFEST, ApiCode.OK);
            String resetId = resetManifest.path("releaseId").asString();
            assertThat(resetId).isNotBlank().isNotIn(baselineId, publishedId, restoredId);
            assertThat(resetManifest.path("components")).isEqualTo(baseline.path("components"));
            viewer.post(QUERY, batch(resetId, "accepted-events"), ApiCode.OK);
            viewer.post(QUERY, batch(baselineId, "accepted-events"), ApiCode.RELEASE_CONFLICT);
        }
    }

    private static ObjectNode layout(JsonNode baseline, String componentId, String title) {
        var component = (ObjectNode) baseline.path("components").get(0).deepCopy();
        component.put("id", componentId).put("title", title);
        var draft = JSON.createObjectNode();
        draft.putArray("components").add(component);
        return draft;
    }

    private static void addCategoryChart(ObjectNode draft, JsonNode baseline, String chartStyle) {
        var category = (ObjectNode) baseline.path("components").get(4).deepCopy();
        category.put("chartStyle", chartStyle);
        ((ArrayNode) draft.path("components")).add(category);
    }

    private static ObjectNode submission(int revision) {
        return JSON.createObjectNode().put("revision", revision);
    }

    private static ObjectNode review(int revision, long serial, String decision, String note) {
        return JSON.createObjectNode().put("revision", revision).put("serial", serial)
                .put("decision", decision).put("note", note);
    }

    private static ObjectNode batch(String releaseId, String componentId) {
        var payload = JSON.createObjectNode().put("releaseId", releaseId);
        payload.putArray("componentIds").add(componentId);
        return payload;
    }

    private static JsonNode data(HttpResponse<String> response, ApiCode expected) {
        assertThat(response.statusCode()).as("%s %s", response.request().method(), response.uri().getPath())
                .isEqualTo(expected.httpStatus());
        JsonNode envelope = JSON.readTree(response.body());
        assertThat(envelope.path("code").asString()).isEqualTo(expected.code());
        return envelope.path("data");
    }

    private final class Browser implements AutoCloseable {
        private final HttpClient client = HttpClient.newBuilder()
                .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER))
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        private JsonNode login(String persona) throws Exception {
            return post("/auth/demo-session", JSON.createObjectNode().put("persona", persona), ApiCode.OK);
        }

        private JsonNode get(String path, ApiCode expected) throws Exception {
            return send(request(path).GET().build(), expected);
        }

        private JsonNode post(String path, JsonNode payload, ApiCode expected) throws Exception {
            return send(postRequest(path, payload), expected);
        }

        private HttpRequest postRequest(String path, JsonNode payload) throws Exception {
            return mutation(path).POST(HttpRequest.BodyPublishers.ofString(payload.toString())).build();
        }

        private JsonNode save(JsonNode payload, int revision) throws Exception {
            return save(payload, revision, ApiCode.OK);
        }

        private JsonNode save(JsonNode payload, int revision, ApiCode expected) throws Exception {
            var request = mutation(DRAFT).header("If-Match", "\"" + revision + "\"")
                    .PUT(HttpRequest.BodyPublishers.ofString(payload.toString())).build();
            return send(request, expected);
        }

        private HttpRequest.Builder mutation(String path) throws Exception {
            JsonNode csrf = get("/auth/csrf", ApiCode.OK);
            return request(path).header(csrf.path("headerName").asString(), csrf.path("token").asString())
                    .header("Content-Type", "application/json");
        }

        private HttpRequest.Builder request(String path) {
            return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1" + path))
                    .timeout(Duration.ofSeconds(10))
                    .header("Accept", "application/json");
        }

        private JsonNode send(HttpRequest request, ApiCode expected) throws Exception {
            return data(client.send(request, HttpResponse.BodyHandlers.ofString()), expected);
        }

        @Override
        public void close() {
            client.close();
        }
    }
}
