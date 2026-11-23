package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.IngestionModels.Asset;
import gov.district.dashboard.ingestion.IngestionModels.ConnectionTest;
import gov.district.dashboard.ingestion.IngestionModels.DatasetSummary;
import gov.district.dashboard.ingestion.IngestionModels.SourceInput;
import gov.district.dashboard.ingestion.IngestionModels.SourceOptions;
import gov.district.dashboard.ingestion.IngestionModels.SourceResponse;
import gov.district.dashboard.ingestion.IngestionModels.SyncRequest;
import gov.district.dashboard.ingestion.IngestionModels.SyncRun;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import gov.district.dashboard.platform.api.ApiResult;
import java.io.IOException;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/admin")
class SourceAdminController {

    private final IngestionService ingestion;

    SourceAdminController(IngestionService ingestion) {
        this.ingestion = ingestion;
    }

    @GetMapping("/sources")
    ApiResult<List<SourceResponse>> sources() {
        return ApiResult.ok(ingestion.list());
    }

    @GetMapping("/sources/{id}")
    ApiResult<SourceResponse> source(@PathVariable String id) {
        return ApiResult.ok(ingestion.show(id));
    }

    @PostMapping("/sources")
    ApiResult<SourceResponse> create(@RequestBody SourceInput input) {
        return ApiResult.ok(ingestion.create(input));
    }

    @PutMapping("/sources/{id}")
    ApiResult<SourceResponse> update(@PathVariable String id, @RequestBody SourceInput input,
                                     @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String version) {
        return ApiResult.ok(ingestion.update(id, input, version));
    }

    @PostMapping("/sources/{id}/connection-tests")
    ApiResult<ConnectionTest> connection(@PathVariable String id) {
        return ApiResult.ok(ingestion.testConnection(id));
    }

    @GetMapping("/sources/{id}/sync-runs")
    ApiResult<List<SyncRun>> runs(@PathVariable String id) {
        return ApiResult.ok(ingestion.runs(id));
    }

    @PostMapping("/sources/{id}/sync-runs")
    ApiResult<SyncRun> sync(@PathVariable String id, @RequestBody(required = false) SyncRequest request,
                           @RequestHeader(value = "Idempotency-Key", required = false) String requestKey) {
        return ApiResult.ok(ingestion.syncManually(id, request == null ? null : request.retryOf(), requestKey));
    }

    @GetMapping("/sources/{id}/dataset")
    ApiResult<DatasetSummary> dataset(@PathVariable String id) {
        return ApiResult.ok(ingestion.dataset(id));
    }

    @GetMapping("/source-options")
    ApiResult<SourceOptions> options() {
        return ApiResult.ok(ingestion.options());
    }

    @PostMapping(path = "/source-assets", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ApiResult<Asset> asset(@RequestPart("file") MultipartFile file) {
        if (file.isEmpty() || file.getSize() > SourceReader.MAX_BYTES) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        try (var contents = file.getInputStream()) {
            return ApiResult.ok(ingestion.upload(file.getOriginalFilename(), contents));
        } catch (IOException unavailable) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
    }
}
