package gov.district.dashboard.demo;

import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("demo")
public final class DemoIdentityService {

    private static final List<String> VIEW_PERMISSIONS = List.of("project:read", "playback:read");
    private static final CurrentIdentity DISTRICT = new CurrentIdentity(
            "demo-district", "区级运行管理者", "区运行协调组", List.of("DISTRICT_VIEWER"),
            VIEW_PERMISSIONS, "demo", "city-operations", "/");
    private static final CurrentIdentity SERVICE = new CurrentIdentity(
            "demo-service", "政务服务管理者", "区政务服务中心", List.of("SERVICE_VIEWER"),
            VIEW_PERMISSIONS, "demo", "public-services", "/play/public-services");

    private static final CurrentIdentity DATA_ADMIN = new CurrentIdentity(
            "demo-data-admin", "数据管理员", "区数据管理组", List.of("DATA_ADMIN"),
            List.of("admin:data:read", "admin:data:write"), "demo", null, "/admin");

    public CurrentIdentity forPersona(String persona) {
        return switch (persona) {
            case "district" -> DISTRICT;
            case "service" -> SERVICE;
            case "data-admin" -> DATA_ADMIN;
            default -> throw new ApiFailure(ApiCode.INVALID_REQUEST);
        };
    }

    public record CurrentIdentity(String id, String displayName, String department, List<String> roles,
                                  List<String> permissions, String mode, String defaultProjectId, String landingPath) {
    }
}
