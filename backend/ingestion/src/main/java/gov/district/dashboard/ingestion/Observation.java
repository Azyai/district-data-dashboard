package gov.district.dashboard.ingestion;

import java.math.BigDecimal;
import java.time.LocalDate;

public record Observation(String regionId, LocalDate observedOn, String measure, BigDecimal value,
                          BigDecimal denominator) {
}
