package gov.district.dashboard.catalog;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record MetricInput(
        @NotBlank @Pattern(regexp = "[a-z][a-z0-9-]{0,63}") String id,
        @NotBlank @Size(max = 80) String label,
        @NotBlank @Size(max = 20) String unit,
        @NotBlank @Pattern(regexp = "[a-z][a-z0-9-]{0,63}") String sourceId,
        @NotBlank @Pattern(regexp = "[a-z][a-z0-9_.-]{0,63}") String measure,
        @NotNull Aggregation aggregation,
        @NotNull @Size(max = 300) String description) {

    public enum Aggregation {
        SUM, RATE
    }
}
