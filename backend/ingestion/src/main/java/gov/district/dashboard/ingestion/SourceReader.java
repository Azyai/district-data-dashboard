package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.IngestionModels.FieldMapping;
import gov.district.dashboard.ingestion.IngestionModels.SourceInput;
import gov.district.dashboard.ingestion.SourceRegistry.HttpsRegistration;
import gov.district.dashboard.ingestion.SourceRegistry.MysqlTarget;
import gov.district.dashboard.platform.api.ApiFailure;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PushbackReader;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.DuplicateHeaderMode;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
final class SourceReader implements AutoCloseable {

    static final int MAX_BYTES = 2 * 1024 * 1024;
    static final int MAX_ROWS = 5000;
    static final Pattern FIELD = Pattern.compile("[A-Za-z_][A-Za-z0-9_.-]{0,63}");
    private static final int MAX_FIELDS = 64;
    private static final int MAX_VALUE_LENGTH = 256;
    private static final int MAX_PAGES = 5;
    private static final Duration HTTP_TIMEOUT = Duration.ofSeconds(8);
    private static final CSVFormat CSV = CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true)
            .setDuplicateHeaderMode(DuplicateHeaderMode.DISALLOW).setAllowMissingColumnNames(false).get();

    private final SourceRegistry registry;
    private final IngestionStore store;
    private final ObjectMapper json;
    private final Semaphore slots = new Semaphore(4);
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    SourceReader(SourceRegistry registry, IngestionStore store, ObjectMapper json) {
        this.registry = registry;
        this.store = store;
        this.json = json;
    }

    @Override
    public void close() {
        http.close();
    }

    RawRows read(SourceInput input) {
        if (!slots.tryAcquire()) {
            throw new ReadFailure("连接器正忙，请稍后重试");
        }
        try {
            return switch (input.type()) {
                case HTTPS_JSON -> readHttps(registry.https(input.config().endpoint()));
                case MYSQL_VIEW -> readMysql(registry.mysql(input.config().connectionRef(), input.config().viewRef()),
                        input.mapping());
                case CSV -> readCsv(store.assetContents(input.config().assetRef()));
            };
        } catch (ApiFailure unavailable) {
            throw new ReadFailure("配置使用的连接或资产已不可用，请重新选择");
        } finally {
            slots.release();
        }
    }

    void validateCsv(byte[] document) {
        parseCsv(document, false);
    }

    private RawRows readCsv(byte[] document) {
        return parseCsv(document, true);
    }

    private RawRows parseCsv(byte[] document, boolean retainRows) {
        try (var csv = new PushbackReader(new InputStreamReader(
                new ByteArrayInputStream(document), StandardCharsets.UTF_8.newDecoder()))) {
            int first = csv.read();
            if (first != -1 && first != '\uFEFF') {
                csv.unread(first);
            }
            try (var parser = CSV.parse(csv)) {
                List<String> fields = parser.getHeaderNames();
                requireFields(fields);
                List<Map<String, String>> rows = retainRows ? new ArrayList<>() : List.of();
                int rowCount = 0;
                for (var record : parser) {
                    requireCapacity(rowCount++);
                    if (!retainRows) {
                        if (!record.isConsistent()) {
                            throw new ReadFailure("CSV 记录列数与表头不一致");
                        }
                        continue;
                    }
                    if (!record.isConsistent()) {
                        rows.add(Map.of());
                        continue;
                    }
                    Map<String, String> row = new LinkedHashMap<>();
                    for (String field : fields) {
                        row.put(field, bounded(record.get(field)));
                    }
                    rows.add(row);
                }
                if (!retainRows && rowCount == 0) {
                    throw new ReadFailure("CSV 需要包含至少一条记录");
                }
                return new RawRows(List.copyOf(fields), rows);
            }
        } catch (UncheckedIOException error) {
            throw invalidCsv(error.getCause());
        } catch (IllegalArgumentException | IOException error) {
            throw invalidCsv(error);
        }
    }

    private static ReadFailure invalidCsv(Exception error) {
        return new ReadFailure(error instanceof CharacterCodingException ? "CSV 必须使用 UTF-8 编码"
                : "CSV 引号、表头或记录格式无效");
    }

    private RawRows readHttps(HttpsRegistration registration) {
        List<Map<String, String>> rows = new ArrayList<>();
        var fields = new LinkedHashSet<String>();
        for (int page = 1; page <= MAX_PAGES; page++) {
            String endpoint = registration.pageParameter() == null ? registration.endpoint()
                    : registration.endpoint() + "?" + registration.pageParameter() + "=" + page;
            JsonNode response = fetchJson(endpoint);
            for (JsonNode element : response) {
                requireCapacity(rows.size());
                if (!element.isObject() || element.size() > MAX_FIELDS) {
                    rows.add(Map.of());
                    continue;
                }
                Map<String, String> row = new LinkedHashMap<>();
                element.properties().forEach(field -> {
                    if (!FIELD.matcher(field.getKey()).matches()) {
                        return;
                    }
                    fields.add(field.getKey());
                    if (fields.size() > MAX_FIELDS) {
                        throw new ReadFailure("接口字段数超过限制");
                    }
                    JsonNode value = field.getValue();
                    row.put(field.getKey(), value.isString() || value.isNumber() ? bounded(value.asString()) : invalidScalar(value));
                });
                rows.add(row);
            }
            if (registration.pageParameter() == null || response.isEmpty()) {
                return new RawRows(List.copyOf(fields), rows);
            }
        }
        throw new ReadFailure("接口分页超过允许范围，未接收不完整批次");
    }

    private JsonNode fetchJson(String url) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(HTTP_TIMEOUT)
                .header("Accept", "application/json").GET().build();
        CompletableFuture<HttpResponse<byte[]>> operation = http.sendAsync(request, ignored -> new BoundedBody());
        try {
            HttpResponse<byte[]> response = operation.get(HTTP_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            if (response.statusCode() != 200) {
                throw new ReadFailure("HTTPS 接口未返回成功状态");
            }
            JsonNode body = json.reader().with(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY).readTree(response.body());
            if (body == null || !body.isArray()) {
                throw new ReadFailure("接口响应必须是 JSON 记录数组");
            }
            return body;
        } catch (InterruptedException error) {
            operation.cancel(true);
            Thread.currentThread().interrupt();
            throw new ReadFailure("HTTPS 请求已中断");
        } catch (TimeoutException error) {
            operation.cancel(true);
            throw new ReadFailure("HTTPS 接口响应超时");
        } catch (ExecutionException error) {
            throw new ReadFailure(error.getCause() instanceof ReadFailure failure
                    ? failure.getMessage() : "无法安全连接 HTTPS 接口");
        } catch (JacksonException error) {
            throw new ReadFailure("HTTPS 接口返回无效 JSON");
        }
    }

    private RawRows readMysql(MysqlTarget target, FieldMapping mapping) {
        Properties connectionProperties = new Properties();
        connectionProperties.setProperty("user", target.username());
        connectionProperties.setProperty("password", target.password());
        connectionProperties.setProperty("connectTimeout", "3000");
        connectionProperties.setProperty("socketTimeout", "5000");
        connectionProperties.setProperty("allowLoadLocalInfile", "false");
        connectionProperties.setProperty("allowMultiQueries", "false");
        try (Connection connection = DriverManager.getConnection(target.jdbcUrl(), connectionProperties)) {
            connection.setReadOnly(true);
            if (!approvedViewExists(connection, target.view())) {
                throw new ReadFailure("已登记视图不存在或无法读取");
            }
            String fixedView = quoteIdentifier(target.view());
            List<String> fields = mysqlFields(connection, fixedView);
            List<String> required = ObservationQuality.mappedFields(mapping);
            if (!fields.containsAll(required)) {
                return new RawRows(fields, List.of());
            }
            String columns = String.join(", ", required.stream().map(SourceReader::quoteIdentifier).toList());
            List<Map<String, String>> rows = new ArrayList<>();
            try (var read = connection.prepareStatement("SELECT " + columns + " FROM " + fixedView + " LIMIT " + (MAX_ROWS + 1))) {
                read.setQueryTimeout(4);
                try (var result = read.executeQuery()) {
                    while (result.next()) {
                        requireCapacity(rows.size());
                        Map<String, String> row = new LinkedHashMap<>();
                        for (int i = 0; i < required.size(); i++) {
                            row.put(required.get(i), bounded(result.getString(i + 1)));
                        }
                        rows.add(row);
                    }
                }
            }
            return new RawRows(fields, rows);
        } catch (SQLException unavailable) {
            throw new ReadFailure("无法安全连接或读取登记的 MySQL 视图");
        }
    }

    private static boolean approvedViewExists(Connection connection, String view) throws SQLException {
        try (var check = connection.prepareStatement("""
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'VIEW'
                """)) {
            check.setString(1, view);
            check.setQueryTimeout(4);
            try (var result = check.executeQuery()) {
                return result.next();
            }
        }
    }

    private static List<String> mysqlFields(Connection connection, String view) throws SQLException {
        try (var discovery = connection.prepareStatement("SELECT * FROM " + view + " LIMIT 0")) {
            discovery.setQueryTimeout(4);
            try (var result = discovery.executeQuery()) {
                ResultSetMetaData metadata = result.getMetaData();
                if (metadata.getColumnCount() > MAX_FIELDS) {
                    throw new ReadFailure("视图字段数超过限制");
                }
                List<String> fields = new ArrayList<>();
                for (int i = 1; i <= metadata.getColumnCount(); i++) {
                    String field = metadata.getColumnLabel(i);
                    if (FIELD.matcher(field).matches()) {
                        fields.add(field);
                    }
                }
                requireFields(fields);
                return List.copyOf(fields);
            }
        }
    }

    private static void requireFields(List<String> fields) {
        if (fields.isEmpty() || fields.size() > MAX_FIELDS || fields.stream().anyMatch(field -> !FIELD.matcher(field).matches())) {
            throw new ReadFailure("来源表头字段为空、无效或超过限制");
        }
    }

    private static void requireCapacity(int rowCount) {
        if (rowCount >= MAX_ROWS) {
            throw new ReadFailure("读取记录超过 5000 行，未接收不完整批次");
        }
    }

    private static String bounded(String value) {
        return value == null || value.length() <= MAX_VALUE_LENGTH ? value : "\uFFFD";
    }

    private static String invalidScalar(JsonNode value) {
        return value.isNull() ? null : "\uFFFD";
    }

    private static String quoteIdentifier(String identifier) {
        if (!FIELD.matcher(identifier).matches()) {
            throw new ReadFailure("视图字段无效");
        }
        return "`" + identifier + "`";
    }

    record RawRows(List<String> fields, List<Map<String, String>> rows) {
    }

    static final class ReadFailure extends RuntimeException {

        ReadFailure(String safeMessage) {
            super(safeMessage);
        }
    }

    private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {

        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;

        @Override
        public CompletionStage<byte[]> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            subscription.request(1);
        }

        @Override
        public void onNext(List<ByteBuffer> chunks) {
            for (ByteBuffer chunk : chunks) {
                if (chunk.remaining() > MAX_BYTES - bytes.size()) {
                    subscription.cancel();
                    result.completeExceptionally(new ReadFailure("HTTPS 响应超过 2 MiB"));
                    return;
                }
                byte[] incoming = new byte[chunk.remaining()];
                chunk.get(incoming);
                bytes.writeBytes(incoming);
            }
            subscription.request(1);
        }

        @Override
        public void onError(Throwable error) {
            result.completeExceptionally(error);
        }

        @Override
        public void onComplete() {
            result.complete(bytes.toByteArray());
        }
    }
}
