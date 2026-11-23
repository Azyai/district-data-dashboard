package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.IngestionModels.HttpsOption;
import gov.district.dashboard.ingestion.IngestionModels.MysqlOption;
import gov.district.dashboard.ingestion.IngestionModels.SourceOptions;
import gov.district.dashboard.ingestion.IngestionModels.ViewOption;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Component
final class SourceRegistry {

    private static final Pattern REFERENCE = Pattern.compile("[a-z][a-z0-9-]{0,63}");
    private static final Pattern SQL_NAME = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,63}");
    private static final Set<String> MYSQL_PROPERTIES = Set.of("sslmode", "trustcertificatekeystoreurl",
            "trustcertificatekeystoretype", "trustcertificatekeystorepassword", "fallbacktosystemtruststore",
            "connectiontimezone", "servertimezone");

    private final List<HttpsRegistration> httpsEndpoints;
    private final List<MysqlRegistration> mysqlConnections;

    SourceRegistry(ObjectMapper json,
                   @Value("${DISTRICT_INGESTION_HTTPS_ENDPOINTS:[]}") String httpsRegistry,
                   @Value("${DISTRICT_INGESTION_MYSQL_CONNECTIONS:[]}") String mysqlRegistry) {
        try {
            httpsEndpoints = List.copyOf(json.readValue(httpsRegistry, new TypeReference<List<HttpsRegistration>>() { }));
            mysqlConnections = List.copyOf(json.readValue(mysqlRegistry, new TypeReference<List<MysqlRegistration>>() { }));
            validateDefinitions();
        } catch (RuntimeException invalidRegistry) {
            throw new IllegalStateException("Invalid operator registration for ingestion connection options");
        }
    }

    SourceOptions options() {
        return new SourceOptions(httpsEndpoints.stream().map(reg -> new HttpsOption(reg.label(), reg.endpoint())).toList(),
                mysqlConnections.stream().map(reg -> new MysqlOption(reg.id(), reg.label(),
                        reg.views().stream().map(view -> new ViewOption(view.id(), view.label())).toList())).toList());
    }

    HttpsRegistration https(String endpoint) {
        return httpsEndpoints.stream().filter(item -> item.endpoint().equals(endpoint)).findFirst()
                .orElseThrow(() -> new ApiFailure(ApiCode.INVALID_REQUEST));
    }

    MysqlTarget mysql(String connectionRef, String viewRef) {
        MysqlRegistration connection = mysqlConnections.stream().filter(item -> item.id().equals(connectionRef))
                .findFirst().orElseThrow(() -> new ApiFailure(ApiCode.INVALID_REQUEST));
        MysqlView view = connection.views().stream().filter(item -> item.id().equals(viewRef))
                .findFirst().orElseThrow(() -> new ApiFailure(ApiCode.INVALID_REQUEST));
        return new MysqlTarget(connection.jdbcUrl(), connection.username(), connection.password(), view.name());
    }

    private void validateDefinitions() {
        require(httpsEndpoints.stream().map(HttpsRegistration::endpoint).distinct().count() == httpsEndpoints.size());
        require(mysqlConnections.stream().map(MysqlRegistration::id).distinct().count() == mysqlConnections.size());
        for (HttpsRegistration item : httpsEndpoints) {
            URI uri = URI.create(item.endpoint());
            require("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getPort() <= 65535
                    && uri.getRawUserInfo() == null && uri.getRawFragment() == null && uri.getRawQuery() == null);
            require(item.endpoint().length() <= 500 && label(item.label()));
            require(item.pageParameter() == null || SQL_NAME.matcher(item.pageParameter()).matches());
        }
        for (MysqlRegistration connection : mysqlConnections) {
            require(REFERENCE.matcher(connection.id()).matches() && label(connection.label()));
            require(connection.username() != null && !connection.username().isBlank() && connection.password() != null);
            require(connection.views() != null && !connection.views().isEmpty());
            require(connection.views().stream().map(MysqlView::id).distinct().count() == connection.views().size());
            validateJdbcUrl(connection.jdbcUrl());
            for (MysqlView view : connection.views()) {
                require(REFERENCE.matcher(view.id()).matches() && SQL_NAME.matcher(view.name()).matches() && label(view.label()));
            }
        }
    }

    private static void validateJdbcUrl(String url) {
        require(url.startsWith("jdbc:mysql://"));
        URI uri = URI.create(url.substring("jdbc:".length()));
        require(uri.getHost() != null && uri.getPort() <= 65535 && uri.getRawUserInfo() == null
                && uri.getRawFragment() == null && uri.getRawPath().matches("/[A-Za-z0-9_-]{1,64}"));
        Map<String, String> properties = new HashMap<>();
        if (uri.getRawQuery() != null) {
            for (String pair : uri.getRawQuery().split("&", -1)) {
                String[] parts = pair.split("=", 2);
                require(parts.length == 2);
                String name = URLDecoder.decode(parts[0], StandardCharsets.UTF_8).toLowerCase(Locale.ROOT);
                require(MYSQL_PROPERTIES.contains(name));
                require(properties.put(name, URLDecoder.decode(parts[1], StandardCharsets.UTF_8)) == null);
            }
        }
        require("VERIFY_IDENTITY".equals(properties.get("sslmode")));
        if (properties.containsKey("trustcertificatekeystoreurl")) {
            URI trust = URI.create(properties.get("trustcertificatekeystoreurl"));
            require("file".equals(trust.getScheme()) && trust.getHost() == null && trust.getRawFragment() == null
                    && trust.getRawQuery() == null && trust.getPath() != null && trust.getPath().startsWith("/"));
        }
    }

    private static boolean label(String value) {
        return value != null && !value.isBlank() && value.length() <= 120 && value.codePoints().noneMatch(Character::isISOControl);
    }

    private static void require(boolean condition) {
        if (!condition) {
            throw new IllegalArgumentException("Invalid operator registration");
        }
    }

    record HttpsRegistration(String label, String endpoint, String pageParameter) {
    }

    record MysqlRegistration(String id, String label, String jdbcUrl, String username, String password,
                             List<MysqlView> views) {
    }

    record MysqlView(String id, String label, String name) {
    }

    record MysqlTarget(String jdbcUrl, String username, String password, String view) {
    }
}
