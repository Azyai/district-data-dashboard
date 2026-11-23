package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiResult;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public final class ApiErrorWriter {

    private final ObjectMapper json;

    ApiErrorWriter(ObjectMapper json) {
        this.json = json;
    }

    public void write(HttpServletResponse response, ApiCode code) throws IOException {
        response.setStatus(code.httpStatus());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        json.writeValue(response.getOutputStream(), ApiResult.error(code));
    }
}
