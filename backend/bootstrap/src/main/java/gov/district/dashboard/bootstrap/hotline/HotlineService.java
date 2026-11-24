package gov.district.dashboard.bootstrap.hotline;

import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("demo")
@Transactional(readOnly = true)
class HotlineService {
    private static final Pattern AREA_ID = Pattern.compile("[a-z][a-z0-9-]{0,63}");
    private static final Pattern MONTH = Pattern.compile("20[0-9]{2}-(?:0[1-9]|1[0-2])");
    private static final Pattern TICKET_ID = Pattern.compile("HL-[0-9]{6}-[0-9]{5}");
    private static final Set<String> LANES = Set.of("all", "open", "due", "late", "closed");
    private static final Set<String> CATEGORIES = Set.of("all", "property", "utilities", "sanitation", "traffic", "other");
    private static final String AREA_FIELDS = "area_id, area_name, area_level, parent_id";
    private static final String SUMS = """
            COUNT(t.ticket_id) AS received,
            COUNT(t.assigned_on) AS assigned,
            SUM(CASE WHEN t.ticket_status = 'closed' THEN 1 ELSE 0 END) AS closed_count,
            SUM(CASE WHEN t.attention_lane = 'open' THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN t.attention_lane = 'due' THEN 1 ELSE 0 END) AS due_count,
            SUM(CASE WHEN t.attention_lane = 'late' THEN 1 ELSE 0 END) AS late_count,
            SUM(CASE WHEN t.ticket_status = 'pending' THEN 1 ELSE 0 END) AS unassigned,
            SUM(CASE WHEN t.ticket_status = 'processing' THEN 1 ELSE 0 END) AS processing
            """;
    private static final String TICKET_FIELDS = """
            SELECT t.ticket_id, t.title, t.area_id, a.area_name, t.town_id, g.area_name AS town_name,
                   t.category_id, c.category_name, t.ticket_status, t.attention_lane, t.elapsed_days,
                   t.opened_on, t.assigned_on, t.processed_on, t.closed_on, t.note
            FROM hotline_ticket t
            JOIN hotline_area a ON t.area_id = a.area_id
            JOIN hotline_area g ON t.town_id = g.area_id
            JOIN hotline_category c ON t.category_id = c.category_id
            """;
    private static final RowMapper<Area> AREA = (row, number) -> new Area(
            row.getString("area_id"), row.getString("area_name"), row.getString("area_level"),
            row.getString("parent_id"));

    private final JdbcTemplate jdbc;

    HotlineService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Overview overview(String areaId, String month) {
        Area area = area(areaId);
        Snapshot snapshot = snapshot(month);
        Scope scope = Scope.forArea(area);
        return new Overview(area, YearMonth.from(snapshot.monthStart()).toString(), snapshot.quality(), snapshot.snapshotOn(), snapshot.thresholds(),
                totals(scope, snapshot.monthStart()), trend(scope), categories(scope, snapshot.monthStart()),
                subdivisions(area, snapshot.monthStart()));
    }

    TicketPage tickets(String areaId, String month, String lane, String category, String pageText, String sizeText) {
        if (!LANES.contains(lane) || !CATEGORIES.contains(category)) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        int page = boundedInteger(pageText, 0, 10_000);
        int size = boundedInteger(sizeText, 1, 100);
        Area area = area(areaId);
        Snapshot snapshot = snapshot(month);
        Scope scope = Scope.forArea(area);
        StringBuilder filter = new StringBuilder(" WHERE t.month_start = ?").append(scope.condition());
        List<Object> arguments = new ArrayList<>(scope.bind(snapshot.monthStart()));
        if (!lane.equals("all")) {
            filter.append(" AND t.attention_lane = ?");
            arguments.add(lane);
        }
        if (!category.equals("all")) {
            filter.append(" AND t.category_id = ?");
            arguments.add(category);
        }
        long total = jdbc.queryForObject("SELECT COUNT(*) FROM hotline_ticket t" + filter,
                Long.class, arguments.toArray());
        List<Ticket> items = List.of();
        if ((long) page * size < total) {
            arguments.add(size);
            arguments.add(page * size);
            items = jdbc.query(TICKET_FIELDS + filter + " ORDER BY t.opened_on DESC, t.ticket_id DESC LIMIT ? OFFSET ?",
                    (row, number) -> ticket(row), arguments.toArray());
        }
        return new TicketPage(area, YearMonth.from(snapshot.monthStart()).toString(), page, size, total, items);
    }

    TicketDetails ticketDetails(String id, String areaId, String month) {
        if (!TICKET_ID.matcher(id).matches()) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        Scope scope = Scope.forArea(area(areaId));
        String filter = " WHERE t.ticket_id = ?" + scope.condition();
        List<Object> arguments = scope.bind(id);
        if (month != null) {
            filter += " AND t.month_start = ?";
            arguments.add(snapshot(month).monthStart());
        }
        return jdbc.query(TICKET_FIELDS + filter, (row, number) -> {
            Ticket ticket = ticket(row);
            List<Step> steps = List.of(
                    step("受理", ticket.openedOn(), false),
                    step("派单", row.getObject("assigned_on", LocalDate.class), ticket.status().equals("pending")),
                    step("办理", row.getObject("processed_on", LocalDate.class), ticket.status().equals("processing")),
                    step("反馈", row.getObject("closed_on", LocalDate.class), false));
            return new TicketDetails(ticket.id(), ticket.title(), ticket.areaId(), ticket.areaName(), ticket.townId(),
                    ticket.townName(), ticket.categoryId(), ticket.category(), ticket.status(), ticket.lane(),
                    ticket.elapsedDays(), ticket.openedOn(), ticket.note(), steps);
        }, arguments.toArray()).stream().findFirst().orElseThrow(() -> new ApiFailure(ApiCode.NOT_FOUND));
    }

    Analysis analysis(String areaId, String month) {
        Area area = area(areaId);
        Snapshot snapshot = snapshot(month);
        Scope scope = Scope.forArea(area);
        LocalDate monthStart = snapshot.monthStart();
        Totals totals = totals(scope, monthStart);
        List<Finding> findings = new ArrayList<>();
        categories(scope, monthStart).stream().filter(category -> category.count() > 0).findFirst().ifPresent(top ->
                findings.add(new Finding("top-category", "高频诉求", "%s类工单最多，共 %d 件。"
                        .formatted(top.label(), top.count()), "received", top.count(), "件")));
        long priorCount = jdbc.queryForObject("SELECT COUNT(*) FROM hotline_ticket t WHERE t.month_start = ?"
                + scope.condition(), Long.class, scope.bind(monthStart.minusMonths(1)).toArray());
        if (priorCount > 0) {
            double change = rounded((totals.received() - priorCount) * 100.0 / priorCount);
            String summary = String.format(Locale.ROOT, "本期 %d 件，上期 %d 件，环比 %+.1f%%。",
                    totals.received(), priorCount, change);
            findings.add(new Finding("month-change", "受理量环比", summary, "receivedMoM", change, "%"));
        }
        findings.add(new Finding("deadline-watch", "办理时限", "当前有 %d 件逾期、%d 件临期。"
                .formatted(totals.late(), totals.due()), "late", totals.late(), "件"));
        findings.add(new Finding("dispatch-watch", "工单派发", "当前有 %d 件待派单。"
                .formatted(totals.unassigned()), "unassigned", totals.unassigned(), "件"));
        return new Analysis(area, YearMonth.from(snapshot.monthStart()).toString(), snapshot.quality(), snapshot.snapshotOn(), totals, List.copyOf(findings));
    }

    Semantics semantics() {
        List<Metric> metrics = jdbc.query("""
                SELECT metric_id, metric_label, metric_description, unit, supported_dimensions
                FROM hotline_semantic ORDER BY metric_id
                """, (row, number) -> new Metric(row.getString(1), row.getString(2), row.getString(3),
                row.getString(4), List.of(row.getString(5).split(","))));
        List<Field> fields = jdbc.query("""
                SELECT source_table, column_name, sql_type, field_description, is_nullable,
                       key_role, reference_table, reference_column, allowed_values
                FROM hotline_field_metadata
                ORDER BY source_table, column_position
                """, (row, number) -> {
            String referenceTable = row.getString("reference_table");
            String allowedValues = row.getString("allowed_values");
            FieldReference reference = referenceTable == null ? null
                    : new FieldReference(referenceTable, row.getString("reference_column"));
            return new Field(row.getString("source_table"), row.getString("column_name"),
                    row.getString("sql_type"), row.getString("field_description"), row.getBoolean("is_nullable"),
                    row.getString("key_role"), reference,
                    allowedValues == null ? List.of() : List.of(allowedValues.split(",")));
        });
        return new Semantics("hotline", metrics, fields);
    }

    private Area area(String id) {
        if (!AREA_ID.matcher(id).matches()) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        return jdbc.query("SELECT " + AREA_FIELDS + " FROM hotline_area WHERE area_id = ?", AREA, id)
                .stream().findFirst().orElseThrow(() -> new ApiFailure(ApiCode.NOT_FOUND));
    }

    private Snapshot snapshot(String month) {
        LocalDate today = LocalDate.now(HotlineDemoCalendar.BEIJING);
        boolean latest = month == null || month.isEmpty();
        if (!latest && (!MONTH.matcher(month).matches() || YearMonth.parse(month).isAfter(YearMonth.from(today)))) {
            throw new ApiFailure(ApiCode.INVALID_REQUEST);
        }
        String predicate = latest ? """
                s.snapshot_on <= ? AND EXISTS (SELECT 1 FROM hotline_ticket t WHERE t.month_start = s.month_start)
                ORDER BY s.month_start DESC LIMIT 1
                """ : "s.month_start = ?";
        return jdbc.query("""
                        SELECT month_start, snapshot_on, quality, due_days, late_days
                        FROM hotline_snapshot s WHERE
                        """ + predicate, (row, number) -> new Snapshot(row.getObject(1, LocalDate.class),
                        row.getObject(2, LocalDate.class), row.getString(3),
                        new Thresholds(row.getInt(4), row.getInt(5))), latest ? today : YearMonth.parse(month).atDay(1))
                .stream().findFirst().orElseThrow(() -> new ApiFailure(ApiCode.INVALID_REQUEST));
    }

    private Totals totals(Scope scope, LocalDate month) {
        return jdbc.queryForObject("SELECT " + SUMS + " FROM hotline_ticket t WHERE t.month_start = ?"
                + scope.condition(), (row, number) -> totals(row), scope.bind(month).toArray());
    }

    private List<TrendPoint> trend(Scope scope) {
        List<Object> arguments = new ArrayList<>(scope.bind());
        arguments.add(LocalDate.now(HotlineDemoCalendar.BEIJING));
        return jdbc.query("""
                SELECT s.month_start, COUNT(t.ticket_id) AS received
                FROM hotline_snapshot s
                LEFT JOIN hotline_ticket t ON t.month_start = s.month_start
                """ + scope.condition() + " WHERE s.snapshot_on <= ? GROUP BY s.month_start ORDER BY s.month_start",
                (row, number) -> new TrendPoint(YearMonth.from(row.getObject(1, LocalDate.class)).toString(),
                        row.getLong(2)), arguments.toArray());
    }

    private List<Category> categories(Scope scope, LocalDate month) {
        return jdbc.query("""
                SELECT c.category_id, c.category_name, COUNT(t.ticket_id) AS received
                FROM hotline_category c
                LEFT JOIN hotline_ticket t ON t.category_id = c.category_id AND t.month_start = ?
                """ + scope.condition() + """
                 GROUP BY c.category_id, c.category_name ORDER BY received DESC, c.category_id
                """, (row, number) -> new Category(row.getString(1), row.getString(2), row.getLong(3)),
                scope.bind(month).toArray());
    }

    private List<AreaTotals> subdivisions(Area area, LocalDate month) {
        if (area.level().equals("village")) {
            return List.of();
        }
        String subdivision = area.level().equals("district") ? "t.town_id" : "t.area_id";
        return jdbc.query("SELECT a.area_id, a.area_name, a.area_level, " + SUMS
                        + " FROM hotline_area a LEFT JOIN hotline_ticket t ON a.area_id = " + subdivision
                        + " AND t.month_start = ? WHERE a.parent_id = ?"
                        + " GROUP BY a.area_id, a.area_name, a.area_level ORDER BY received DESC, a.area_id",
                (row, number) -> {
                    Totals totals = totals(row);
                    return new AreaTotals(row.getString(1), row.getString(2), row.getString(3), totals.received(),
                            totals.assigned(), totals.closed(), totals.open(), totals.due(), totals.late(),
                            totals.unassigned(), totals.processing(), totals.closedRate());
                }, month, area.id());
    }

    private static Totals totals(ResultSet row) throws SQLException {
        long received = row.getLong("received");
        long closed = row.getLong("closed_count");
        return new Totals(received, row.getLong("assigned"), closed, row.getLong("open_count"),
                row.getLong("due_count"), row.getLong("late_count"), row.getLong("unassigned"),
                row.getLong("processing"), received == 0 ? 0 : rounded(closed * 100.0 / received));
    }

    private static Ticket ticket(ResultSet row) throws SQLException {
        return new Ticket(row.getString("ticket_id"), row.getString("title"), row.getString("area_id"),
                row.getString("area_name"), row.getString("town_id"), row.getString("town_name"),
                row.getString("category_id"), row.getString("category_name"), row.getString("ticket_status"),
                row.getString("attention_lane"), row.getInt("elapsed_days"),
                row.getObject("opened_on", LocalDate.class), row.getString("note"));
    }

    private static Step step(String label, LocalDate date, boolean active) {
        return new Step(label, active ? "active" : (date != null ? "done" : "pending"), date);
    }

    private static int boundedInteger(String value, int min, int max) {
        try {
            int number = Integer.parseInt(value);
            if (number >= min && number <= max) {
                return number;
            }
        } catch (NumberFormatException ignored) {
            // Both malformed values and values beyond the API limits use INVALID_REQUEST.
        }
        throw new ApiFailure(ApiCode.INVALID_REQUEST);
    }

    private static double rounded(double number) {
        return Math.round(number * 10) / 10.0;
    }

    private record Scope(String condition, String id) {
        static Scope forArea(Area area) {
            return switch (area.level()) {
                case "district" -> new Scope("", null);
                case "town" -> new Scope(" AND t.town_id = ?", area.id());
                case "village" -> new Scope(" AND t.area_id = ?", area.id());
                default -> throw new ApiFailure(ApiCode.INTERNAL_ERROR);
            };
        }

        List<Object> bind(Object... initial) {
            List<Object> arguments = new ArrayList<>(List.of(initial));
            if (id != null) {
                arguments.add(id);
            }
            return arguments;
        }
    }

    private record Snapshot(LocalDate monthStart, LocalDate snapshotOn, String quality, Thresholds thresholds) {}

    record Area(String id, String name, String level, String parentId) {}
    record Thresholds(int dueDays, int lateDays) {}
    record Totals(long received, long assigned, long closed, long open, long due, long late, long unassigned,
                  long processing, double closedRate) {}
    record TrendPoint(String month, long received) {}
    record Category(String id, String label, long count) {}
    record AreaTotals(String id, String name, String level, long received, long assigned, long closed,
                      long open, long due, long late, long unassigned, long processing, double closedRate) {}
    record Overview(Area area, String month, String quality, LocalDate snapshotOn, Thresholds thresholds,
                    Totals totals, List<TrendPoint> trend, List<Category> categories, List<AreaTotals> areas) {}
    record Ticket(String id, String title, String areaId, String areaName, String townId, String townName,
                  String categoryId, String category, String status, String lane, int elapsedDays, LocalDate openedOn,
                  String note) {}
    record TicketPage(Area area, String month, int page, int size, long total, List<Ticket> items) {}
    record Step(String label, String state, LocalDate on) {}
    record TicketDetails(String id, String title, String areaId, String areaName, String townId, String townName,
                         String categoryId, String category, String status, String lane, int elapsedDays,
                         LocalDate openedOn, String note, List<Step> steps) {}
    record Finding(String id, String title, String summary, String metricId, double value, String unit) {}
    record Analysis(Area area, String month, String quality, LocalDate snapshotOn, Totals totals, List<Finding> findings) {}
    record Metric(String id, String label, String description, String unit, List<String> dimensions) {}
    record FieldReference(String table, String column) {}
    record Field(String table, String column, String sqlType, String description, boolean nullable, String key,
                 FieldReference reference, List<String> allowedValues) {}
    record Semantics(String dataset, List<Metric> metrics, List<Field> fields) {}
}
