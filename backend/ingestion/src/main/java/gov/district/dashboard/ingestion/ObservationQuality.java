package gov.district.dashboard.ingestion;

import gov.district.dashboard.ingestion.IngestionModels.FieldMapping;
import gov.district.dashboard.ingestion.SourceReader.RawRows;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

final class ObservationQuality {

    private static final Pattern REGION = Pattern.compile("[a-z][a-z0-9-]{0,63}");
    private static final Pattern MEASURE = Pattern.compile("[a-z][a-z0-9_.-]{0,63}");
    private static final Pattern DECIMAL = Pattern.compile("-?[0-9]{1,18}(?:\\.[0-9]{1,6})?");
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    private static final Comparator<Observation> ORDER = Comparator.comparing(Observation::regionId)
            .thenComparing(Observation::observedOn).thenComparing(Observation::measure);

    private ObservationQuality() {
    }

    static Check inspect(RawRows raw, FieldMapping mapping) {
        if (raw.rows().isEmpty() && raw.fields().isEmpty()) {
            return new Check(List.of(), 0, 0, "来源没有可同步的观测记录");
        }
        if (!raw.fields().containsAll(mappedFields(mapping))) {
            return new Check(List.of(), raw.rows().size(), raw.rows().size(), "来源缺少已映射字段，请检查表头或接口版本");
        }
        if (raw.rows().isEmpty()) {
            return new Check(List.of(), 0, 0, "来源没有可同步的观测记录");
        }
        var accepted = new ArrayList<Observation>();
        var reasons = new ArrayList<String>();
        var seen = new HashSet<ObservationKey>();
        for (int i = 0; i < raw.rows().size(); i++) {
            try {
                Observation row = normalize(raw.rows().get(i), mapping);
                if (!seen.add(new ObservationKey(row.regionId(), row.observedOn(), row.measure()))) {
                    throw new InvalidRow("区域、日期与度量重复");
                }
                accepted.add(row);
            } catch (InvalidRow error) {
                if (reasons.size() < 5) {
                    reasons.add("第 " + (i + 1) + " 条：" + error.getMessage());
                }
            }
        }
        int rejected = raw.rows().size() - accepted.size();
        String message = rejected == 0 ? "质量校验通过"
                : "拒绝 " + rejected + " 条记录。" + String.join("。", reasons);
        return new Check(List.copyOf(accepted), raw.rows().size(), rejected, message);
    }

    static List<String> mappedFields(FieldMapping mapping) {
        var names = new ArrayList<>(List.of(mapping.region(), mapping.date(), mapping.measure(), mapping.value()));
        if (mapping.denominator() != null) {
            names.add(mapping.denominator());
        }
        return List.copyOf(names);
    }

    static String fingerprint(List<Observation> observations) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            observations.stream().sorted(ORDER).forEach(item -> {
                String canonical = item.regionId() + "|" + item.observedOn() + "|" + item.measure() + "|"
                        + item.value().stripTrailingZeros().toPlainString() + "|"
                        + (item.denominator() == null ? "" : item.denominator().stripTrailingZeros().toPlainString()) + "\n";
                digest.update(canonical.getBytes(StandardCharsets.UTF_8));
            });
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 unavailable", unavailable);
        }
    }

    private static Observation normalize(Map<String, String> fields, FieldMapping mapping) {
        String region = field(fields, mapping.region());
        if (!REGION.matcher(region).matches()) {
            throw new InvalidRow("区域标识无效");
        }
        String date = field(fields, mapping.date());
        LocalDate observedOn = date(date);
        String measure = field(fields, mapping.measure());
        if (!MEASURE.matcher(measure).matches()) {
            throw new InvalidRow("度量标识无效");
        }
        BigDecimal value = decimal(field(fields, mapping.value()), "数值");
        BigDecimal denominator = null;
        if (mapping.denominator() != null) {
            if (!fields.containsKey(mapping.denominator())) {
                throw new InvalidRow("缺少分母字段");
            }
            String input = field(fields, mapping.denominator());
            if (!input.isEmpty()) {
                denominator = decimal(input, "分母");
                if (denominator.signum() < 0) {
                    throw new InvalidRow("分母不能为负数");
                }
            }
        }
        return new Observation(region, observedOn, measure, value, denominator);
    }

    private static LocalDate date(String input) {
        if (!DATE.matcher(input).matches()) {
            throw new InvalidRow("日期须为 YYYY-MM-DD");
        }
        try {
            LocalDate date = LocalDate.parse(input);
            if (date.getYear() < 1000) {
                throw new InvalidRow("日期超出范围");
            }
            return date;
        } catch (DateTimeParseException error) {
            throw new InvalidRow("日期无效");
        }
    }

    private static BigDecimal decimal(String input, String label) {
        if (!DECIMAL.matcher(input).matches()) {
            throw new InvalidRow(label + "须是有效十进制数，最多 6 位小数");
        }
        return new BigDecimal(input);
    }

    private static String field(Map<String, String> fields, String name) {
        String value = fields.get(name);
        return value == null ? "" : value.trim();
    }

    record Check(List<Observation> accepted, int total, int rejected, String message) {

        boolean passed() {
            return rejected == 0 && !accepted.isEmpty();
        }
    }

    private record ObservationKey(String regionId, LocalDate observedOn, String measure) {
    }

    private static final class InvalidRow extends RuntimeException {

        InvalidRow(String message) {
            super(message);
        }
    }
}
